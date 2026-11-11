import { createHash } from 'crypto';
import type { ProviderRuntime } from '../../registry';
import { str, timedFetch } from '../../http';
import { EcommerceBillingError } from '../../../errors';

/** Moloni API v1 (built from the public docs, not verified against a live account). */
export const MOLONI_BASE_URL = 'https://api.moloni.pt/v1';
const TIMEOUT_MS = 20000;
/** Tokens are renewed this long before they expire. */
const RENEW_MARGIN_MS = 60000;

type Token = { accessToken: string; refreshToken: string | null; expiresAt: number };
type Raw = { status: number; body: unknown };

/**
 * Module cache keyed by `clientId:username` plus a hash of the secrets, so new credentials never
 * reuse a token granted to the old ones; tokens live in memory only.
 */
let tokens = new Map<string, Token>();
let grants = new Map<string, Promise<Token>>();

export function __resetMoloniTokensForTests(): void {
  tokens = new Map();
  grants = new Map();
}

/**
 * Sends one request. The callback never throws on an HTTP or JSON problem: it returns
 * `{ status, body }` and errors are mapped by the caller, because `timedFetch` turns any throw
 * into `null` (= unreachable).
 */
export async function moloniSend(url: string, init: RequestInit, timeoutMs: number = TIMEOUT_MS): Promise<Raw | null> {
  return timedFetch<Raw>(
    url,
    init,
    async (res) => {
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: res.status, body };
    },
    timeoutMs
  );
}

const unreachable = (uncertain: boolean) =>
  new EcommerceBillingError('BILLING_UNREACHABLE', 'Could not reach Moloni.', uncertain);
const authFailed = () => new EcommerceBillingError('BILLING_AUTH_FAILED', 'Moloni rejected the credentials.');

const ERROR_KEYS = new Set(['code', 'field', 'description']);

/** Moloni validation errors: `[{ code, field, description }]` (entity lists never look like this). */
function errorList(body: unknown): { code: unknown; field: unknown }[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const isError = (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e && Object.keys(e).every((k) => ERROR_KEYS.has(k));
  return body.every(isError) ? (body as { code: unknown; field: unknown }[]) : null;
}

const isInvalidToken = (res: Raw) => {
  const error = (res.body as any)?.error;
  return res.status === 401 || (typeof error === 'string' && /token/i.test(error));
};

export function createMoloniClient(rt: ProviderRuntime) {
  /** `requireCompany: false` for calls made before a company is chosen (`companies/getAll`). */
  function credentials(requireCompany = true) {
    const values = {
      clientId: str(rt, 'clientId'),
      clientSecret: str(rt, 'clientSecret'),
      username: str(rt, 'username'),
      password: str(rt, 'password'),
      companyId: str(rt, 'companyId'),
    };
    const missing = Object.entries(values)
      .filter(([k, v]) =>
        k === 'companyId' ? requireCompany && !(Number.isInteger(Number(v)) && Number(v) > 0) : !v
      )
      .map(([k]) => k);
    if (missing.length) throw new EcommerceBillingError('BILLING_CONFIG_MISSING', `Missing fields: ${missing.join(', ')}`);
    return { ...values, companyId: Number(values.companyId) };
  }
  type Credentials = ReturnType<typeof credentials>;

  /** Returns the token, or null when Moloni refused the grant. Never exposes the URL (it carries secrets). */
  async function grant(params: Record<string, string>): Promise<Token | null> {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const res = await moloniSend(`${MOLONI_BASE_URL}/grant/?${query}`, { method: 'GET' });
    if (!res || res.status >= 500) throw unreachable(false);
    const b = res.body as any;
    if (res.status < 200 || res.status >= 300 || typeof b?.access_token !== 'string' || !b.access_token) return null;
    const expiresIn = Number(b.expires_in) > 0 ? Number(b.expires_in) : 3600;
    return {
      accessToken: b.access_token,
      refreshToken: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : null,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  /**
   * Cached token; `force` skips the cached token and its refresh token (the current token was
   * rejected). A grant already in flight is shared even when forced: it yields a new token anyway.
   */
  async function token(c: Credentials, force: boolean): Promise<Token> {
    const fingerprint = createHash('sha256').update(`${c.clientSecret}\u0000${c.password}`).digest('hex');
    const key = `${c.clientId}:${c.username}:${fingerprint}`;
    const cached = tokens.get(key);
    if (!force && cached && Date.now() < cached.expiresAt - RENEW_MARGIN_MS) return cached;
    const inflight = grants.get(key);
    if (inflight) return inflight;

    const p = (async () => {
      const base = { client_id: c.clientId, client_secret: c.clientSecret };
      let t: Token | null = null;
      if (!force && cached?.refreshToken) {
        t = await grant({ grant_type: 'refresh_token', ...base, refresh_token: cached.refreshToken });
      }
      t ??= await grant({ grant_type: 'password', ...base, username: c.username, password: c.password });
      if (!t) {
        tokens.delete(key);
        throw authFailed();
      }
      tokens.set(key, t);
      return t;
    })();
    grants.set(key, p);
    try {
      return await p;
    } finally {
      grants.delete(key);
    }
  }

  /** Maps a response to its body or a billing error. Messages carry `field:code` only, never values. */
  function interpret(path: string, res: Raw, write: boolean): unknown {
    if (res.status >= 500) throw unreachable(write);
    const errors = errorList(res.body);
    if (errors) {
      const detail = errors.map((e) => `${String(e.field ?? '')}:${String(e.code)}`).join(', ');
      throw new EcommerceBillingError('BILLING_REQUEST_FAILED', `Moloni rejected ${path} (${detail}).`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new EcommerceBillingError('BILLING_REQUEST_FAILED', `Moloni rejected ${path} (HTTP ${res.status}).`);
    }
    if (res.body === null || typeof res.body !== 'object') {
      // A write may have been applied even though the answer is unreadable.
      throw new EcommerceBillingError('BILLING_REQUEST_FAILED', `Unreadable Moloni response for ${path}.`, write);
    }
    if ((res.body as any).valid === 0) {
      throw new EcommerceBillingError('BILLING_REQUEST_FAILED', `Moloni rejected ${path}.`);
    }
    return res.body;
  }

  return {
    get companyId(): number {
      return credentials().companyId;
    },

    /** `company: false` leaves out `company_id` (and does not require it), e.g. `companies/getAll`. */
    async call<T>(
      path: string,
      body: Record<string, unknown> = {},
      opts: { write?: boolean; company?: boolean } = {}
    ): Promise<T> {
      const write = opts.write === true;
      const withCompany = opts.company !== false;
      const c = credentials(withCompany);
      const payload = JSON.stringify(withCompany ? { ...body, company_id: c.companyId } : body);
      for (let attempt = 0; ; attempt++) {
        const t = await token(c, attempt > 0);
        const res = await moloniSend(
          `${MOLONI_BASE_URL}/${path}/?access_token=${encodeURIComponent(t.accessToken)}&json=true`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
          TIMEOUT_MS
        );
        if (!res) throw unreachable(write);
        if (!isInvalidToken(res)) return interpret(path, res, write) as T;
        // A rejected token means the request was not processed: one retry with a new grant.
        if (attempt >= 1) throw authFailed();
      }
    },
  };
}

export type MoloniClient = ReturnType<typeof createMoloniClient>;
