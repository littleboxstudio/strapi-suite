import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStripeClient,
  encodeForm,
  isDefinitiveStripeRejection,
  verifyStripeSignature,
} from '../../../../server/src/services/modules/ecommerce/providers/payments/stripeClient';
import { EcommercePaymentError } from '../../../../server/src/services/modules/ecommerce/errors';

const rt = { config: {}, secrets: { secretKey: 'sk_test_SECRET', webhookSecret: 'whsec_x' } };

function stubFetch(fn: (url: string, init: any) => Promise<any>) {
  const m = vi.fn(fn);
  vi.stubGlobal('fetch', m);
  return m;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('encodeForm', () => {
  it('encodes nested objects and arrays', () => {
    const out = encodeForm({ a: { b: [{ c: 'x y' }, 'z'] }, n: 5, skip: undefined });
    const params = new URLSearchParams(out);
    expect(params.get('a[b][0][c]')).toBe('x y');
    expect(params.get('a[b][1]')).toBe('z');
    expect(params.get('n')).toBe('5');
    expect(params.has('skip')).toBe(false);
  });
});

describe('createCheckoutSession', () => {
  it('sends form body and headers', async () => {
    const f = stubFetch(async () =>
      json(200, { id: 'cs_1', url: 'https://pay', status: 'open', expires_at: 1900000000, payment_intent: null })
    );
    const res = await createStripeClient(rt).createCheckoutSession({
      amount: 1234,
      currency: 'EUR',
      description: 'Order #1',
      customerEmail: 'a@b.pt',
      successUrl: 'https://s',
      cancelUrl: 'https://c',
      expiresAt: 1900000000,
      metadata: { orderId: '7' },
      idempotencyKey: 'idem-1',
    });
    expect(res).toEqual({ id: 'cs_1', url: 'https://pay', status: 'open', expiresAt: 1900000000, paymentIntentId: null });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk_test_SECRET');
    expect(init.headers['Stripe-Version']).toBe('2024-06-20');
    expect(init.headers['Idempotency-Key']).toBe('idem-1');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const p = new URLSearchParams(init.body);
    expect(p.get('mode')).toBe('payment');
    expect(p.get('metadata[orderId]')).toBe('7');
    expect(p.get('payment_intent_data[metadata][orderId]')).toBe('7');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('1234');
    expect(p.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('customer_email')).toBe('a@b.pt');
    expect(p.get('expires_at')).toBe('1900000000');
  });

  it('401 -> STRIPE_REQUEST_FAILED without the key', async () => {
    stubFetch(async () => json(401, { error: { message: 'Invalid API Key provided: sk_test_SECRET' } }));
    const err: any = await createStripeClient(rt)
      .createRefund({ paymentIntentId: 'pi_1', amount: 5, idempotencyKey: 'k', metadata: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommercePaymentError);
    expect(err.code).toBe('STRIPE_REQUEST_FAILED');
    expect(err.message).not.toContain('sk_test');
  });

  it('exposes the Stripe error type, never the message', async () => {
    stubFetch(async () =>
      json(400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests sk_test_SECRET' } })
    );
    const err: any = await createStripeClient(rt).retrieveCheckoutSession('cs_1').catch((e) => e);
    expect(err.code).toBe('STRIPE_REQUEST_FAILED');
    expect(err.stripeErrorType).toBe('idempotency_error');
    expect(err.message).not.toContain('sk_test');
  });

  it('network error -> STRIPE_UNREACHABLE', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const err: any = await createStripeClient(rt).retrieveCheckoutSession('cs_1').catch((e) => e);
    expect(err.code).toBe('STRIPE_UNREACHABLE');
  });

  it('missing key -> STRIPE_NOT_CONFIGURED', async () => {
    const err: any = await createStripeClient({ config: {}, secrets: {} })
      .retrieveCheckoutSession('cs_1')
      .catch((e) => e);
    expect(err.code).toBe('STRIPE_NOT_CONFIGURED');
  });
});

describe('retrieve / expire / refund', () => {
  it('maps retrieve', async () => {
    stubFetch(async () =>
      json(200, { id: 'cs_1', status: 'complete', payment_status: 'paid', payment_intent: 'pi_9', amount_total: 99, metadata: { orderId: '7' } })
    );
    expect(await createStripeClient(rt).retrieveCheckoutSession('cs_1')).toEqual({
      id: 'cs_1', status: 'complete', paymentStatus: 'paid', paymentIntentId: 'pi_9', amountTotal: 99, metadata: { orderId: '7' },
    });
  });

  it('expire returns the resulting status on 2xx', async () => {
    const f = stubFetch(async () => json(200, { id: 'cs_1', status: 'expired' }));
    await expect(createStripeClient(rt).expireCheckoutSession('cs_1')).resolves.toBe('expired');
    expect(f.mock.calls[0][0]).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1/expire');
    expect(f.mock.calls[0][1].method).toBe('POST');
  });

  it('expire on 400 retrieves the session and returns its status', async () => {
    const f = stubFetch(async (_url, init) =>
      init.method === 'POST'
        ? json(400, { error: { message: 'anything' } })
        : json(200, { id: 'cs_1', status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' })
    );
    await expect(createStripeClient(rt).expireCheckoutSession('cs_1')).resolves.toBe('complete');
    expect(f.mock.calls[1][0]).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1');
    expect(f.mock.calls[1][1].method).toBe('GET');
  });

  it('expire on 400 throws when the session is still open', async () => {
    stubFetch(async (_url, init) =>
      init.method === 'POST'
        ? json(400, { error: { message: 'x' } })
        : json(200, { id: 'cs_1', status: 'open', payment_status: 'unpaid' })
    );
    await expect(createStripeClient(rt).expireCheckoutSession('cs_1')).rejects.toMatchObject({
      code: 'STRIPE_REQUEST_FAILED',
    });
  });

  it('expire throws on other errors', async () => {
    stubFetch(async () => json(500, {}));
    await expect(createStripeClient(rt).expireCheckoutSession('cs_1')).rejects.toMatchObject({
      code: 'STRIPE_REQUEST_FAILED',
    });
  });

  it('creates a refund', async () => {
    const f = stubFetch(async () => json(200, { id: 're_1', status: 'pending' }));
    expect(
      await createStripeClient(rt).createRefund({ paymentIntentId: 'pi_1', amount: 50, idempotencyKey: 'k', metadata: { refundId: '3' } })
    ).toEqual({ id: 're_1', status: 'pending' });
    const p = new URLSearchParams(f.mock.calls[0][1].body);
    expect(p.get('payment_intent')).toBe('pi_1');
    expect(p.get('amount')).toBe('50');
    expect(p.get('metadata[refundId]')).toBe('3');
  });
});

describe('retrievePaymentIntent / retrieveRefund', () => {
  it('GET /v1/payment_intents/:id maps id and status', async () => {
    const f = stubFetch(async () => json(200, { id: 'pi_1', object: 'payment_intent', status: 'canceled', amount: 10 }));
    expect(await createStripeClient(rt).retrievePaymentIntent('pi_1')).toEqual({ id: 'pi_1', status: 'canceled' });
    expect(f.mock.calls[0][0]).toBe('https://api.stripe.com/v1/payment_intents/pi_1');
    expect(f.mock.calls[0][1].method).toBe('GET');
  });

  it('GET /v1/refunds/:id maps id, status and failure_reason', async () => {
    const f = stubFetch(async () =>
      json(200, { id: 're_1', object: 'refund', status: 'failed', failure_reason: 'lost_or_stolen_card' })
    );
    expect(await createStripeClient(rt).retrieveRefund('re_1')).toEqual({
      id: 're_1',
      status: 'failed',
      failureReason: 'lost_or_stolen_card',
    });
    expect(f.mock.calls[0][0]).toBe('https://api.stripe.com/v1/refunds/re_1');
    expect(f.mock.calls[0][1].method).toBe('GET');
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1"}');
  const sign = (t: number, b: Buffer = body) =>
    createHmac('sha256', secret).update(`${t}.`).update(b).digest('hex');
  const now = 1_700_000_000;

  it('accepts a valid signature', () => {
    expect(verifyStripeSignature(body, `t=${now},v1=${sign(now)}`, secret, now)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), `t=${now},v1=${sign(now)}`, secret, now)).toBe(false);
  });
  it('rejects an old timestamp', () => {
    const t = now - 400;
    expect(verifyStripeSignature(body, `t=${t},v1=${sign(t)}`, secret, now)).toBe(false);
  });
  it('accepts when one of several v1 is valid', () => {
    expect(verifyStripeSignature(body, `t=${now},v1=${'0'.repeat(64)},v1=${sign(now)}`, secret, now)).toBe(true);
  });
  it('rejects garbage headers', () => {
    expect(verifyStripeSignature(body, 'garbage', secret, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now},v1=zz`, secret, now)).toBe(false);
  });
});

describe('refund failure classification', () => {
  it('a non-2xx answer carries its HTTP status', async () => {
    stubFetch(async () => json(409, { error: { type: 'idempotency_error' } }));
    const err: any = await createStripeClient(rt)
      .createRefund({ paymentIntentId: 'pi_1', amount: 5, idempotencyKey: 'k', metadata: {} })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'STRIPE_REQUEST_FAILED', httpStatus: 409, stripeErrorType: 'idempotency_error' });
  });

  it('only 400/402/404 with a Stripe error body (not idempotency_error) are definitive', () => {
    const e = (status?: number, type?: string) =>
      new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'x', type, status);
    expect(isDefinitiveStripeRejection(e(400, 'invalid_request_error'))).toBe(true);
    expect(isDefinitiveStripeRejection(e(402, 'card_error'))).toBe(true);
    expect(isDefinitiveStripeRejection(e(404, 'invalid_request_error'))).toBe(true);
    expect(isDefinitiveStripeRejection(e(400))).toBe(false);
    expect(isDefinitiveStripeRejection(e(400, 'idempotency_error'))).toBe(false);
    expect(isDefinitiveStripeRejection(e(409, 'idempotency_error'))).toBe(false);
    expect(isDefinitiveStripeRejection(e(429, 'rate_limit_error'))).toBe(false);
    expect(isDefinitiveStripeRejection(e(500, 'api_error'))).toBe(false);
    expect(isDefinitiveStripeRejection(e(undefined, 'invalid_request_error'))).toBe(false);
    expect(isDefinitiveStripeRejection(new EcommercePaymentError('STRIPE_UNREACHABLE'))).toBe(false);
    expect(isDefinitiveStripeRejection(new Error('x'))).toBe(false);
  });
});
