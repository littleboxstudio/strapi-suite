import { EcommerceCarrierError } from '../../../errors';
import { str, timedFetch } from '../../http';
import type { ProviderRuntime } from '../../registry';
import type { CarrierCallOptions } from '../types';

/**
 * DPD Portugal REST API (spec 2.1), built from the working integration the spec cites; there is no
 * official documentation. A token is requested per operation, never cached. Error messages never
 * carry credentials, tokens, URLs or DPD response bodies.
 */

type Raw = { status: number; body: unknown };
type Options = Partial<CarrierCallOptions>;

/** The DPD credentials a token needs (config fields and secrets). */
export const DPD_AUTH_CREDENTIALS = ['authEndpoint', 'clientId', 'clientSecret', 'username', 'password'] as const;

/** Every DPD credential a shipment needs (Ruling 8): the token's plus the expedition endpoint. */
export const DPD_CREDENTIALS = [...DPD_AUTH_CREDENTIALS, 'expeditionEndpoint'] as const;

/** Whether `rt` has every DPD credential, whether the integration is active or not. */
export const hasDpdCredentials = (rt: ProviderRuntime): boolean =>
  DPD_CREDENTIALS.every((key) => str(rt, key).trim() !== '');

/** POSTs JSON; the callback never throws, so `null` means only "no answer" (network/timeout). */
const postJson = (url: string, body: unknown, headers: Record<string, string>, opts: Options) =>
  timedFetch<Raw>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    async (res) => {
      let parsed: unknown = null;
      try {
        const text = await res.text();
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed };
    },
    opts.timeoutMs
  );

const record = (v: unknown): Record<string, any> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, any>) : null;

/** Access token for the password grant. */
export async function dpdToken(rt: ProviderRuntime, opts: Options = {}): Promise<string> {
  const missing = DPD_AUTH_CREDENTIALS.filter((key) => !str(rt, key));
  if (missing.length) {
    throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED', `Missing DPD fields: ${missing.join(', ')}`);
  }
  const res = await postJson(
    str(rt, 'authEndpoint'),
    {
      username: str(rt, 'username'),
      password: str(rt, 'password'),
      client_id: str(rt, 'clientId'),
      client_secret: str(rt, 'clientSecret'),
      grant_type: 'password',
    },
    {},
    opts
  );
  if (!res) throw new EcommerceCarrierError('CARRIER_UNREACHABLE', 'Could not reach DPD.');
  const body = record(res.body);
  const token = record(body?.result)?.access_token;
  if (body?.status_code !== 200 || typeof token !== 'string' || !token) {
    throw new EcommerceCarrierError('DPD_AUTH_FAILED', 'DPD rejected the credentials.');
  }
  return token;
}

/**
 * Creates the expedition. Errors before the request (auth, configuration) and explicit refusals are
 * certain; no answer, a 5xx, or a success without a guide number are `uncertain` (DPD may have
 * created it, and it does not deduplicate by reference as far as we know).
 */
export async function dpdCreateExpedition(
  rt: ProviderRuntime,
  body: Record<string, unknown>,
  opts: Options = {}
): Promise<{ trackingCode: string; labelUrl: string }> {
  const endpoint = str(rt, 'expeditionEndpoint');
  if (!endpoint) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED', 'Missing DPD fields: expeditionEndpoint');
  const token = await dpdToken(rt, opts);
  const res = await postJson(endpoint, body, { Authorization: `Bearer ${token}` }, opts);
  if (!res) throw new EcommerceCarrierError('CARRIER_UNREACHABLE', 'Could not reach DPD.', true);
  if (res.status >= 500) {
    throw new EcommerceCarrierError('DPD_SHIPMENT_FAILED', `DPD failed (HTTP ${res.status}).`, true);
  }
  const answer = record(res.body);
  const statusCode = answer?.status_code;
  if (res.status < 200 || res.status >= 300 || (statusCode !== undefined && statusCode !== 200)) {
    const detail = typeof statusCode === 'number' ? `status ${statusCode}` : `HTTP ${res.status}`;
    throw new EcommerceCarrierError('DPD_SHIPMENT_FAILED', `DPD refused the shipment (${detail}).`);
  }
  const result = record(answer?.result);
  const guide = Array.isArray(result?.num_guia) ? result!.num_guia[0] : result?.num_guia;
  const trackingCode = typeof guide === 'string' || typeof guide === 'number' ? String(guide).trim() : '';
  const labelUrl = typeof result?.pdf_url === 'string' ? result.pdf_url.trim() : '';
  if (!trackingCode || !labelUrl) {
    throw new EcommerceCarrierError('DPD_SHIPMENT_FAILED', 'DPD answered without a guide number or label.', true);
  }
  return { trackingCode, labelUrl };
}

/** Downloads the label PDF returned by the expedition (`pdf_url`). */
export async function dpdDownloadLabel(labelUrl: string, opts: Options = {}): Promise<Buffer> {
  if (!/^https?:\/\//i.test(labelUrl)) {
    throw new EcommerceCarrierError('CARRIER_REQUEST_FAILED', 'The DPD label link is invalid.');
  }
  const res = await timedFetch<{ status: number; content: Buffer }>(
    labelUrl,
    { method: 'GET' },
    async (r) => ({ status: r.status, content: r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0) }),
    opts.timeoutMs
  );
  if (!res) throw new EcommerceCarrierError('CARRIER_UNREACHABLE', 'Could not reach DPD.');
  if (res.status !== 200 || res.content.length === 0) {
    throw new EcommerceCarrierError('CARRIER_REQUEST_FAILED', `The DPD label could not be downloaded (HTTP ${res.status}).`);
  }
  return res.content;
}
