import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFrom, sendWithResend } from '../../../../server/src/services/modules/ecommerce/providers/email/resendSender';
import { EcommerceEmailError } from '../../../../server/src/services/modules/ecommerce/errors';

const API_KEY = 're_live_SuperSecretKey123';
const rt = (config: Record<string, unknown> = { fromEmail: 'shop@example.com', fromName: 'Acme Shop' }) => ({
  config,
  secrets: { apiKey: API_KEY },
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendWithResend', () => {
  it('posts the e-mail with from, base64 attachments and the idempotency key', async () => {
    const fetchMock = stubFetch(200, { id: 'email_123' });
    const result = await sendWithResend(rt(), {
      to: 'joao@example.com',
      subject: 'Invoice',
      html: '<p>Hi</p>',
      attachments: [
        { filename: 'invoice.pdf', content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' },
      ],
      idempotencyKey: 'order-1-invoice',
    });

    expect(result).toEqual({ id: 'email_123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Idempotency-Key']).toBe('order-1-invoice');
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe('Acme Shop <shop@example.com>');
    expect(body.to).toEqual(['joao@example.com']);
    expect(body.subject).toBe('Invoice');
    expect(body.html).toBe('<p>Hi</p>');
    expect(body.attachments).toEqual([
      {
        filename: 'invoice.pdf',
        content: Buffer.from('%PDF-1.4 fake').toString('base64'),
        content_type: 'application/pdf',
      },
    ]);
  });

  it('omits the idempotency header and uses the bare address without a from name', async () => {
    const fetchMock = stubFetch(200, { id: 'email_9' });
    await sendWithResend(rt({ fromEmail: 'shop@example.com' }), { to: 'a@b.com', subject: 's', html: 'h' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe('shop@example.com');
    expect(body.attachments).toBeUndefined();
  });

  it('maps a 401 to EMAIL_SEND_FAILED without leaking the key', async () => {
    stubFetch(401, { message: `API key ${API_KEY} is invalid` });
    const err = await sendWithResend(rt(), { to: 'a@b.com', subject: 's', html: 'h' }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceEmailError);
    expect(err.code).toBe('EMAIL_SEND_FAILED');
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain('SuperSecret');
  });

  it('maps a network failure to EMAIL_SEND_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed with ${API_KEY}`);
      })
    );
    const err = await sendWithResend(rt(), { to: 'a@b.com', subject: 's', html: 'h' }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceEmailError);
    expect(err.code).toBe('EMAIL_SEND_FAILED');
    expect(err.message).not.toContain(API_KEY);
  });

  it('throws EMAIL_NOT_CONFIGURED when the key or sender is missing', async () => {
    const fetchMock = stubFetch(200, { id: 'x' });
    const noKey = await sendWithResend(
      { config: { fromEmail: 'shop@example.com' }, secrets: {} },
      { to: 'a@b.com', subject: 's', html: 'h' }
    ).catch((e) => e);
    expect(noKey.code).toBe('EMAIL_NOT_CONFIGURED');
    const noFrom = await sendWithResend(
      { config: {}, secrets: { apiKey: API_KEY } },
      { to: 'a@b.com', subject: 's', html: 'h' }
    ).catch((e) => e);
    expect(noFrom.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quotes the sender name per RFC 5322 when it contains specials', async () => {
    expect(formatFrom('Acme Shop', 'a@b.com')).toBe('Acme Shop <a@b.com>');
    expect(formatFrom('Name, Inc.', 'a@b.com')).toBe('"Name, Inc." <a@b.com>');
    expect(formatFrom('Say "Hi" \\ Co', 'a@b.com')).toBe('"Say \\"Hi\\" \\\\ Co" <a@b.com>');
    expect(formatFrom('  ', 'a@b.com')).toBe('a@b.com');

    const fetchMock = stubFetch(200, { id: 'x' });
    await sendWithResend(rt({ fromEmail: 'shop@example.com', fromName: 'Name, Inc.' }), {
      to: 'a@b.com',
      subject: 's',
      html: 'h',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).from).toBe('"Name, Inc." <shop@example.com>');
  });
});
