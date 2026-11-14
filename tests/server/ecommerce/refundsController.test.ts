import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { STRIPE_WEBHOOK_EVENTS } from '../../../server/src/services/modules/ecommerce/stripeWebhooks';
import createRefunds from '../../../server/src/controllers/modules/ecommerce/refunds';
import createCredits from '../../../server/src/controllers/modules/ecommerce/storeCredits';
import createNotifications from '../../../server/src/controllers/modules/ecommerce/notifications';
import createOrders from '../../../server/src/controllers/modules/ecommerce/orders';
import createSettings from '../../../server/src/controllers/modules/ecommerce/settings';

const strapiWith = (services: Record<string, any>, config: Record<string, unknown> = {}) =>
  ({
    plugin: () => ({ service: (n: string) => services[n], controller: () => ({}) }),
    config: { get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback) },
  }) as any;

const mkCtx = (extra: any = {}): any => ({
  params: { id: '5' },
  query: {},
  request: { body: {} },
  state: { user: { id: 7 } },
  badRequest: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});
const body = (b: any, extra: any = {}) => mkCtx({ request: { body: b }, ...extra });

describe('EcommerceRefundController', () => {
  const valid = { method: 'MANUAL_TRANSFER', amount: 1000, reason: 'OTHER', idempotencyKey: 'k' };

  it('create validates the body and never calls the service on bad input', async () => {
    const create = vi.fn();
    const c = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { create } }) });
    for (const bad of [
      { ...valid, amount: 10.5 },
      { ...valid, amount: 0 },
      { ...valid, amount: 1e9 + 1 },
      { ...valid, amount: '10' },
      { ...valid, idempotencyKey: '' },
      { ...valid, idempotencyKey: 'x'.repeat(256) },
      { ...valid, reason: undefined },
      { ...valid, description: 'x'.repeat(5001) },
      { ...valid, paymentId: 1.5 },
    ]) {
      const ctx = body(bad);
      await c.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: expect.any(String) }));
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('caps client idempotency keys at 200 (derived keys stay within 255) and reason at 255', async () => {
    const create = vi.fn().mockResolvedValue([]);
    const c = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { create } }) });
    const long = body({ ...valid, idempotencyKey: 'x'.repeat(201) });
    await c.create(long);
    expect(long.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'too_long' }));
    const longReason = body({ ...valid, reason: 'x'.repeat(256) });
    await c.create(longReason);
    expect(longReason.badRequest).toHaveBeenCalled();
    const ok = body({ ...valid, idempotencyKey: 'x'.repeat(200), reason: 'x'.repeat(255) });
    await c.create(ok);
    expect(create).toHaveBeenCalledTimes(1);
    // longest derived keys: refund `${key}:${paymentId}` sent as `refund:${key}:${paymentId}`;
    // store credit `admin-issue:${key}`
    expect(`refund:${'x'.repeat(200)}:${Number.MAX_SAFE_INTEGER}`.length).toBeLessThanOrEqual(255);
    expect(`admin-issue:${'x'.repeat(200)}`.length).toBeLessThanOrEqual(255);
  });

  it('create passes the input and the actor, status 201', async () => {
    const create = vi.fn().mockResolvedValue([{ id: 1 }]);
    const c = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { create } }) });
    const ctx = body({ ...valid, reference: 'R1', paymentId: 3 });
    await c.create(ctx);
    expect(create).toHaveBeenCalledWith(5, expect.objectContaining({ ...valid, reference: 'R1', paymentId: 3 }), 'user:7');
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual([{ id: 1 }]);
  });

  it('maps validation codes to 400 with details.code and conflicts to 409', async () => {
    const reject = (code: string) =>
      vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'a', code }]));
    const c = createRefunds({
      strapi: strapiWith({ EcommerceRefundService: { resume: reject('REFUND_NOT_RESUMABLE'), markFailed: reject('IDEMPOTENCY_KEY_CONFLICT') } }),
    });
    const a = mkCtx();
    await c.resume(a);
    expect(a.badRequest).toHaveBeenCalledWith(expect.any(String), {
      code: 'REFUND_NOT_RESUMABLE',
      errors: [{ path: 'a', code: 'REFUND_NOT_RESUMABLE' }],
    });
    const b = mkCtx();
    await c.markFailed(b);
    expect(b.status).toBe(409);
    expect(b.body.error.details.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('resume and markFailed use the actor; not found maps to 404; bad id is 400', async () => {
    const resume = vi.fn().mockRejectedValue(new EcommerceNotFoundError('x'));
    const markFailed = vi.fn().mockResolvedValue({ id: 5 });
    const c = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { resume, markFailed } }) });
    const a = mkCtx();
    await c.resume(a);
    expect(resume).toHaveBeenCalledWith(5, 'user:7');
    expect(a.notFound).toHaveBeenCalled();
    const b = body({ note: 'checked' });
    await c.markFailed(b);
    expect(markFailed).toHaveBeenCalledWith(5, 'user:7', { note: 'checked' });
    const bad = mkCtx({ params: { id: 'x' } });
    await c.preview(bad);
    expect(bad.badRequest).toHaveBeenCalledWith('Invalid id');
  });

  it('F5: refresh uses the actor and maps REFUND_NOT_REFRESHABLE to 400 with its code', async () => {
    const refresh = vi.fn().mockResolvedValue({ id: 5, status: 'COMPLETED' });
    const c = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { refresh } }) });
    const a = mkCtx();
    await c.refresh(a);
    expect(refresh).toHaveBeenCalledWith(5, 'user:7');
    expect(a.body).toEqual({ id: 5, status: 'COMPLETED' });
    const rejected = vi
      .fn()
      .mockRejectedValue(new EcommerceValidationError('x', [{ path: 'status', code: 'REFUND_NOT_REFRESHABLE' }]));
    const c2 = createRefunds({ strapi: strapiWith({ EcommerceRefundService: { refresh: rejected } }) });
    const b = mkCtx();
    await c2.refresh(b);
    expect(b.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'REFUND_NOT_REFRESHABLE' }));
  });
});

describe('EcommerceStoreCreditController key length', () => {
  it('issue and store-credit-payment reject keys above 200', async () => {
    const issue = vi.fn();
    const credits = createCredits({ strapi: strapiWith({ EcommerceStoreCreditService: { issue } }) });
    const a = body({ customerId: 1, amount: 100, idempotencyKey: 'x'.repeat(201) });
    await credits.issue(a);
    expect(a.badRequest).toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    const add = vi.fn();
    const orders = createOrders({ strapi: strapiWith({ EcommercePaymentService: { addStoreCreditPayment: add } }) });
    const b = body({ code: 'AAAA-BBBB-CCCC', idempotencyKey: 'x'.repeat(201) });
    await orders.addStoreCreditPayment(b);
    expect(b.badRequest).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('EcommerceStoreCreditController', () => {
  it('issue validates, prefixes the idempotency key and uses the actor', async () => {
    const issue = vi.fn().mockResolvedValue({ id: 1, code: 'AAAA-BBBB-CCCC' });
    const c = createCredits({ strapi: strapiWith({ EcommerceStoreCreditService: { issue } }) });
    const bad = body({ customerId: 1, amount: 1e9 + 1, idempotencyKey: 'k' });
    await c.issue(bad);
    expect(bad.badRequest).toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();

    const ctx = body({ customerId: 3, amount: 2500, conditions: 'c', idempotencyKey: 'k' });
    await c.issue(ctx);
    expect(issue).toHaveBeenCalledWith({
      customerId: 3,
      amount: 2500,
      expiresAt: undefined,
      conditions: 'c',
      actor: 'user:7',
      operationKey: 'admin-issue:k',
    });
    expect(ctx.status).toBe(201);
    expect(ctx.body.code).toBe('AAAA-BBBB-CCCC'); // admins may see the code
  });

  it('void maps STORE_CREDIT_CONFLICT to 409; list passes page and search', async () => {
    const list = vi.fn().mockResolvedValue({ results: [] });
    const voidFn = vi
      .fn()
      .mockRejectedValue(new EcommerceValidationError('x', [{ path: 'balance', code: 'STORE_CREDIT_CONFLICT' }]));
    const c = createCredits({ strapi: strapiWith({ EcommerceStoreCreditService: { list, void: voidFn } }) });
    const a = mkCtx();
    await c.void(a);
    expect(voidFn).toHaveBeenCalledWith(5, 'user:7');
    expect(a.status).toBe(409);
    await c.list(mkCtx({ query: { page: '2', search: 'abc' } }));
    expect(list).toHaveBeenCalledWith({ page: 2, search: 'abc' });
  });
});

describe('EcommerceNotificationController', () => {
  const row = { id: 1, orderId: 5, type: 'X', status: 'FAILED', payload: { code: 'SECRET' }, error: null };

  it('never returns payload (list and resend)', async () => {
    const svc = {
      listForOrder: vi.fn().mockResolvedValue([row]),
      resend: vi.fn().mockResolvedValue({ ...row, status: 'SENT' }),
    };
    const c = createNotifications({ strapi: strapiWith({ EcommerceNotificationService: svc }) });
    const a = mkCtx();
    await c.listForOrder(a);
    expect(JSON.stringify(a.body)).not.toContain('SECRET');
    expect(a.body[0]).not.toHaveProperty('payload');
    const b = mkCtx();
    await c.resend(b);
    expect(svc.resend).toHaveBeenCalledWith(5, 'user:7');
    expect(JSON.stringify(b.body)).not.toContain('SECRET');
    expect(b.body.status).toBe('SENT');
  });

  it('a SKIPPED resend because e-mail is not configured is EMAIL_NOT_CONFIGURED (400)', async () => {
    const resend = vi.fn().mockResolvedValue({ ...row, status: 'SKIPPED', error: 'EMAIL_NOT_CONFIGURED' });
    const c = createNotifications({ strapi: strapiWith({ EcommerceNotificationService: { resend } }) });
    const ctx = mkCtx();
    await c.resend(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'EMAIL_NOT_CONFIGURED' });
  });

  it('a SKIPPED resend for another reason (no recipient) is returned as is', async () => {
    const resend = vi.fn().mockResolvedValue({ ...row, status: 'SKIPPED', error: 'NO_RECIPIENT' });
    const c = createNotifications({ strapi: strapiWith({ EcommerceNotificationService: { resend } }) });
    const ctx = mkCtx();
    await c.resend(ctx);
    expect(ctx.body.error).toBe('NO_RECIPIENT');
  });
});

describe('order payment endpoints', () => {
  it('POST /orders/:id/payments answers an idempotency key clash with 409', async () => {
    const addManualPayment = vi
      .fn()
      .mockRejectedValue(new EcommerceValidationError('x', [{ path: 'idempotencyKey', code: 'IDEMPOTENCY_KEY_CONFLICT' }]));
    const c = createOrders({ strapi: strapiWith({ EcommercePaymentService: { addManualPayment } }) });
    const ctx = body({ amount: 100, methodLabel: 'MB WAY', idempotencyKey: 'k' });
    await c.addPayment(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('payment-link leaves the purpose to the service, strips the session id and maps payment errors to 400 code', async () => {
    const getOrCreatePaymentLink = vi
      .fn()
      .mockResolvedValueOnce({ url: 'https://s', expiresAt: 'e', amount: 100, reused: false, sessionId: 'cs_1' })
      .mockRejectedValueOnce(new EcommercePaymentError('NOTHING_DUE'));
    const computeOrderState = vi.fn();
    const c = createOrders({
      strapi: strapiWith({
        EcommerceOrderService: { computeOrderState },
        EcommerceStripePaymentService: { getOrCreatePaymentLink },
      }),
    });
    const a = mkCtx();
    await c.createPaymentLink(a);
    expect(getOrCreatePaymentLink).toHaveBeenCalledWith(5, { actor: 'user:7' });
    expect(computeOrderState).not.toHaveBeenCalled();
    expect(a.body).toEqual({ url: 'https://s', expiresAt: 'e', amount: 100, reused: false });
    const b = mkCtx();
    await c.createPaymentLink(b);
    expect(b.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'NOTHING_DUE' });
  });

  it('payment-instructions validates mode, passes methodLabel and rejects long values', async () => {
    const sendPaymentInstructions = vi.fn().mockResolvedValue({});
    const c = createOrders({ strapi: strapiWith({ EcommercePaymentService: { sendPaymentInstructions } }) });
    const bad = [{ mode: 'X' }, { mode: 'MANUAL' }, { mode: 'MANUAL', instructions: 'i', methodLabel: 'x'.repeat(256) }];
    for (const b of bad) {
      const ctx = body(b);
      await c.sendPaymentInstructions(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    }
    expect(sendPaymentInstructions).not.toHaveBeenCalled();
    await c.sendPaymentInstructions(body({ mode: 'MANUAL', instructions: 'Pay to X', methodLabel: 'MB WAY' }));
    expect(sendPaymentInstructions).toHaveBeenCalledWith(
      5,
      { mode: 'MANUAL', instructions: 'Pay to X', methodLabel: 'MB WAY' },
      'user:7'
    );
    await c.sendPaymentInstructions(body({ mode: 'STRIPE' }));
    expect(sendPaymentInstructions).toHaveBeenLastCalledWith(5, { mode: 'STRIPE' }, 'user:7');
  });

  it('store-credit-payment requires code and idempotencyKey', async () => {
    const addStoreCreditPayment = vi.fn().mockResolvedValue({ id: 1 });
    const c = createOrders({ strapi: strapiWith({ EcommercePaymentService: { addStoreCreditPayment } }) });
    const bad = body({ code: 'AAAA' });
    await c.addStoreCreditPayment(bad);
    expect(bad.badRequest).toHaveBeenCalled();
    const ctx = body({ code: 'AAAA-BBBB-CCCC', idempotencyKey: 'k' });
    await c.addStoreCreditPayment(ctx);
    expect(addStoreCreditPayment).toHaveBeenCalledWith(5, { code: 'AAAA-BBBB-CCCC', idempotencyKey: 'k' }, 'user:7');
    expect(ctx.status).toBe(201);
  });
});

describe('stripe webhook info', () => {
  it('lists exactly the events the webhook service handles', () => {
    const src = readFileSync('server/src/services/modules/ecommerce/stripeWebhooks.ts', 'utf8');
    const handled = [...src.matchAll(/case '([a-z_.]+)':/g)].map((m) => m[1]).filter((t) => /^(checkout|charge|refund)\./.test(t));
    expect([...STRIPE_WEBHOOK_EVENTS].sort()).toEqual([...new Set(handled)].sort());
    const c = createSettings({ strapi: strapiWith({}) });
    const ctx = mkCtx();
    c.getStripeWebhook(ctx);
    expect(ctx.body).toEqual({
      path: '/api/littlebox-strapi-suite/ecommerce/stripe/webhook',
      events: [...STRIPE_WEBHOOK_EVENTS],
    });
  });

  it('F9: the path follows api.rest.prefix, like the raw-body middleware', () => {
    const c = createSettings({ strapi: strapiWith({}, { 'api.rest.prefix': '/v2/' }) });
    const ctx = mkCtx();
    c.getStripeWebhook(ctx);
    expect(ctx.body.path).toBe('/v2/littlebox-strapi-suite/ecommerce/stripe/webhook');
  });
});
