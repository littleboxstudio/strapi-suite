import type { ProviderRuntime } from '../registry';
import { str, timedFetch } from '../http';
import { EcommerceEmailError } from '../../errors';

const RESEND_URL = 'https://api.resend.com/emails';

/** RFC 5322 display name: quoted (inner quotes/backslashes escaped) when it has specials. */
export function formatFrom(name: string, email: string): string {
  const clean = name.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return email;
  const display = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(clean)
    ? clean
    : `"${clean.replace(/["\\]/g, (c) => `\\${c}`)}"`;
  return `${display} <${email}>`;
}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  idempotencyKey?: string;
};

/** Sends one e-mail through Resend. Errors never carry the API key or the provider's response body. */
export async function sendWithResend(rt: ProviderRuntime, msg: EmailMessage): Promise<{ id: string }> {
  const apiKey = str(rt, 'apiKey');
  const fromEmail = str(rt, 'fromEmail');
  const fromName = str(rt, 'fromName');
  if (!apiKey || !fromEmail) {
    throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not configured.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (msg.idempotencyKey) headers['Idempotency-Key'] = msg.idempotencyKey;

  const body: Record<string, unknown> = {
    from: formatFrom(fromName, fromEmail),
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
  };
  if (msg.attachments?.length) {
    body.attachments = msg.attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString('base64'),
      content_type: a.contentType,
    }));
  }

  const result = await timedFetch<{ status: number; id: string | null }>(
    RESEND_URL,
    { method: 'POST', headers, body: JSON.stringify(body) },
    async (res) => {
      const json: any = await res.json().catch(() => null);
      return { status: res.status, id: typeof json?.id === 'string' ? json.id : null };
    }
  );
  if (!result) throw new EcommerceEmailError('EMAIL_SEND_FAILED', 'Could not reach Resend.');
  if (result.status < 200 || result.status >= 300 || !result.id) {
    throw new EcommerceEmailError(
      'EMAIL_SEND_FAILED',
      `Resend did not accept the e-mail (HTTP ${result.status}).`
    );
  }
  return { id: result.id };
}
