import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveRefund: vi.fn(),
}));
vi.mock(
  '../../../server/src/services/modules/ecommerce/providers/payments/stripeClient',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createStripeClient: () => stripe,
  })
);

import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const usageKey = (promotionId: number, email: string) => `p${promotionId}:${sha(email)}`;
const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const promotion = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Interno-${id}`,
  description: null,
  code: null,
  method: 'AUTOMATIC',
  active: true,
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  priority: 0,
  displayName: {},
  eligibility: { mode: 'ALL' },
  conditions: group(),
  benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  usageLimit: null,
  perCustomerLimit: null,
  perOrderLimit: null,
  redemptions: 0,
  version: 1,
  ...over,
});

let sessionSeq = 0;

beforeEach(() => {
  __resetEventHandlersForTests();
  sessionSeq = 0;
  for (const fn of Object.values(stripe)) fn.mockReset();
  const byKey = new Map<string, any>();
  stripe.createCheckoutSession.mockImplementation(async (p: any) => {
    if (byKey.has(p.idempotencyKey)) return byKey.get(p.idempotencyKey);
    sessionSeq += 1;
    const s = {
      id: `cs_${sessionSeq}`,
      url: `https://checkout.stripe.com/c/pay/cs_${sessionSeq}`,
      status: 'open',
      expiresAt: p.expiresAt,
      paymentIntentId: null,
    };
    byKey.set(p.idempotencyKey, s);
    return s;
  });
  stripe.expireCheckoutSession.mockResolvedValue('expired');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = () => {
  const c = setupCommerce();
  const sessions = c.services.EcommerceStorefrontSessionService;
  const checkout = c.services.EcommerceStorefrontCheckoutService;
  const open = async () => {
    const { token } = await sessions.open(null);
    return { token: token as string, s: await sessions.resolve(token) };
  };
  /** Marks the session's e-mail as verified (what confirmEmailVerification writes) and re-resolves. */
  const verify = async (token: string, email: string) => {
    const row = c.tables[UIDS.checkoutSession].find((r) => r.tokenHash === sha(token));
    row.verifiedEmail = email.trim().toLowerCase();
    return sessions.resolve(token);
  };
  const cart = (over: Record<string, unknown> = {}) => ({
    lines: [{ variantId: 10, quantity: 2 }],
    locale: 'en',
    ...over,
  });
  const orderInput = (over: Record<string, unknown> = {}) => ({
    customer: { firstName: 'Ana', lastName: 'Silva', email: 'Ana@Example.pt' },
    shippingAddress: address,
    billingAddress: null,
    locale: 'en',
    lines: [{ variantId: 10, quantity: 2 }],
    shippingMethod: { providerId: 'manual', serviceId: '1' },
    expectedTotal: 4500,
    ...over,
  });
  const storedCart = (token: string) =>
    c.tables[UIDS.checkoutSession].find((r) => r.tokenHash === sha(token)).cart;
  const addPromotion = (id: number, over: Record<string, unknown> = {}) => {
    c.tables[UIDS.promotion].push(promotion(id, over));
    return id;
  };
  const issueCredit = async (email: string, amount: number) => {
    const customer = await c.services.EcommerceCustomerService.findOrCreate({
      firstName: 'X',
      lastName: 'Y',
      email,
    });
    return c.storeCredits.issue({
      customerId: customer.id,
      amount,
      actor: 'user:1',
      operationKey: `issue:${email}:${amount}`,
    });
  };
  return {
    c,
    sessions,
    checkout,
    open,
    verify,
    cart,
    orderInput,
    storedCart,
    addPromotion,
    issueCredit,
  };
};

const failure = async (p: Promise<unknown>) => {
  const err: any = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

const deductions = (c: Commerce) =>
  c.tables[UIDS.stockMovement].filter((m) => m.type === 'ORDER_DEDUCT');

const WEBHOOK_SECRET = 'whsec_test_123';
const signed = (payload: unknown) => {
  const raw = Buffer.from(JSON.stringify(payload));
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
  return { raw, signature: `t=${t},v1=${v1}` };
};

describe('EcommerceStorefrontCheckoutService', () => {
  describe('quote', () => {
    it('saves the cart before quoting; resolve(...).cart returns it', async () => {
      const t = setup();
      const { token, s } = await t.open();
      const input = t.cart({ email: 'ana@example.pt', promotionCodes: ['verao20'] });
      const q = await t.checkout.quote(s, input);
      expect(q.totals.subtotal).toBe(4000);
      const again = await t.sessions.resolve(token);
      expect(again.cart).toMatchObject({
        lines: [{ variantId: 10, quantity: 2 }],
        promotionCodes: ['VERAO20'],
        email: 'ana@example.pt',
        locale: 'en',
        destination: null,
        shippingMethod: null,
      });
    });

    it('saves the cart even when the quote fails', async () => {
      const t = setup();
      const { token, s } = await t.open();
      await expect(
        t.checkout.quote(s, t.cart({ lines: [{ variantId: 999, quantity: 1 }] }))
      ).rejects.toBeInstanceOf(EcommerceValidationError);
      expect(t.storedCart(token).lines).toEqual([{ variantId: 999, quantity: 1 }]);
    });

    it('refuses an unbounded or malformed cart before saving it', async () => {
      const t = setup();
      const { token, s } = await t.open();
      const lines = Array.from({ length: 101 }, (_, i) => ({ variantId: i + 1, quantity: 1 }));
      expect(await failure(t.checkout.quote(s, t.cart({ lines })))).toEqual([
        { path: 'lines', code: 'too_many' },
      ]);
      expect(
        await failure(t.checkout.quote(s, t.cart({ lines: [{ variantId: 10, quantity: 1.5 }] })))
      ).toEqual([{ path: 'lines.0.quantity', code: 'invalid' }]);
      expect(
        await failure(
          t.checkout.quote(s, t.cart({ promotionCodes: ['A', 'B', 'C', 'D', 'E', 'F'] }))
        )
      ).toEqual([{ path: 'promotionCodes', code: 'too_many' }]);
      expect(t.storedCart(token).lines).toEqual([]);
    });

    it('with a destination and no method: shippingOptions filled, selectedShipping null, no failures', async () => {
      const t = setup();
      const { s } = await t.open();
      const q = await t.checkout.quote(
        s,
        t.cart({ destination: { country: 'PT', postalCode: '1000-001' } })
      );
      expect(q.shippingOptions).toEqual([
        { providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, estimatedDays: 2 },
        { providerId: 'manual', serviceId: '2', name: 'Express', price: 900, estimatedDays: null },
      ]);
      expect(q.selectedShipping).toBeNull();
      expect(q.totals.shippingTotal).toBeNull();
      expect(JSON.stringify(q)).not.toContain('failures');
      expect(JSON.stringify(q)).not.toContain('CARRIER_UNREACHABLE');
      expect(t.c.services.EcommerceShippingService.quote).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'PT', postalCode: '1000-001', locale: 'en' })
      );
    });

    it('with a method: shippingTotal and a VAT row for shipping', async () => {
      const t = setup();
      const { s } = await t.open();
      const q = await t.checkout.quote(
        s,
        t.cart({
          destination: { country: 'PT' },
          shippingMethod: { providerId: 'manual', serviceId: '1' },
        })
      );
      expect(q.totals.shippingTotal).toBe(500);
      expect(q.totals.total).toBe(4500);
      expect(q.selectedShipping).toMatchObject({
        providerId: 'manual',
        serviceId: '1',
        price: 500,
      });
      // Lines (4000) and shipping (500) are both at 23 %.
      expect(q.taxes).toEqual([{ rate: 23, base: 3659, vat: 841, gross: 4500 }]);
    });

    it('without a destination: shippingOptions null and no carrier quote', async () => {
      const t = setup();
      const { s } = await t.open();
      const q = await t.checkout.quote(s, t.cart());
      expect(q.shippingOptions).toBeNull();
      expect(t.c.services.EcommerceShippingService.quote).not.toHaveBeenCalled();
    });

    it('an empty cart gives an empty quote without calling the order service', async () => {
      const t = setup();
      const { token, s } = await t.open();
      const spy = vi.spyOn(t.c.orders, 'quote');
      const q = await t.checkout.quote(s, t.cart({ lines: [], destination: { country: 'PT' } }));
      expect(spy).not.toHaveBeenCalled();
      expect(q).toMatchObject({
        lines: [],
        promotions: [],
        codes: [],
        giftOptions: [],
        taxes: [],
        currency: 'EUR',
        shippingOptions: null,
        selectedShipping: null,
      });
      expect(Object.values(q.totals).every((v) => v === 0 || v === null)).toBe(true);
      expect(q.totals.total).toBe(0);
      expect(t.storedCart(token).lines).toEqual([]);
    });

    it('Review Focus 4: a per-customer exhausted code is NOT_ELIGIBLE with the en message; no internal data', async () => {
      const t = setup();
      const id = t.addPromotion(1, {
        method: 'CODE',
        code: 'ONCE',
        perCustomerLimit: 1,
        displayName: { pt: 'Uma vez' },
      });
      t.c.tables[UIDS.promotionCustomerUsage].push({
        id: 1,
        promotion: id,
        emailNormalized: 'ana@example.pt',
        uses: 1,
        uniqueKey: usageKey(id, 'ana@example.pt'),
      });
      t.addPromotion(2, { name: 'CAMP-INTERNA', code: 'AUTO-ADMIN' });
      const { token } = await t.open();
      const s = await t.verify(token, 'ana@example.pt');
      const q = await t.checkout.quote(
        s,
        t.cart({ email: 'Ana@Example.pt', promotionCodes: ['once'] })
      );
      expect(q.codes).toEqual([
        {
          code: 'ONCE',
          status: 'NOT_ELIGIBLE',
          message: 'This code is not available for this order.',
        },
      ]);
      expect(q.promotions).toEqual([
        { promotionId: 2, name: 'Promotion', code: null, amount: 400, classes: ['ORDER_DISCOUNT'] },
      ]);
      const json = JSON.stringify(q);
      for (const leak of [
        'CUSTOMER_LIMIT_REACHED',
        'Interno',
        'CAMP-INTERNA',
        'AUTO-ADMIN',
        'snapshot',
        '"stock"',
      ]) {
        expect(json).not.toContain(leak);
      }
    });

    it('perCustomerLimit without a verified e-mail → EMAIL_NOT_VERIFIED, same as for an e-mail that never bought', async () => {
      const t = setup();
      const id = t.addPromotion(1, { method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
      t.c.tables[UIDS.promotionCustomerUsage].push({
        id: 1,
        promotion: id,
        emailNormalized: 'ana@example.pt',
        uses: 1,
        uniqueKey: usageKey(id, 'ana@example.pt'),
      });
      const { s } = await t.open();
      const bought = await t.checkout.quote(
        s,
        t.cart({ email: 'ana@example.pt', promotionCodes: ['ONCE'] })
      );
      const never = await t.checkout.quote(
        s,
        t.cart({ email: 'rui@example.pt', promotionCodes: ['ONCE'] })
      );
      expect(bought.codes).toEqual(never.codes);
      expect(bought.codes[0].status).toBe('EMAIL_NOT_VERIFIED');
    });

    it('emailVerified comes only from the session, never from the request', async () => {
      const t = setup();
      const { s } = await t.open();
      const spy = vi.spyOn(t.c.orders, 'quote');
      await t.checkout.quote(s, {
        ...t.cart({ email: 'ana@example.pt' }),
        emailVerified: true,
      } as any);
      expect(spy.mock.calls[0][0]).toMatchObject({ emailVerified: false });
      await t.checkout.quote(s, t.cart());
      expect(spy.mock.calls[1][0]).toMatchObject({ emailVerified: false });
    });
  });

  describe('applyDiscount', () => {
    it('an applicable code: applied, no redemption, the saved cart has the code', async () => {
      const t = setup();
      t.addPromotion(1, {
        method: 'CODE',
        code: 'VERAO20',
        displayName: { en: 'Summer' },
        benefits: { items: [{ type: 'ORDER_PERCENT', percent: 20 }] },
      });
      const { token, s } = await t.open();
      const r = await t.checkout.applyDiscount(s, { ...t.cart(), code: ' verao20 ' });
      expect(r).toMatchObject({
        code: 'VERAO20',
        status: 'APPLIED',
        message: 'Code applied.',
        applied: true,
      });
      expect(r.quote.promotions).toEqual([
        {
          promotionId: 1,
          name: 'Summer',
          code: 'VERAO20',
          amount: 800,
          classes: ['ORDER_DISCOUNT'],
        },
      ]);
      expect(t.c.tables[UIDS.promotionRedemption]).toEqual([]);
      expect(t.storedCart(token).promotionCodes).toEqual(['VERAO20']);
    });

    it('an unknown code, or one that does not apply, is never saved', async () => {
      const t = setup();
      t.addPromotion(1, {
        method: 'CODE',
        code: 'BIG',
        conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 100000 }]),
      });
      const { token, s } = await t.open();
      const saveCart = vi.spyOn(t.sessions, 'saveCart');

      const unknown = await t.checkout.applyDiscount(s, { ...t.cart(), code: 'GHOST' });
      expect(unknown).toMatchObject({ code: 'GHOST', status: 'NOT_FOUND', applied: false });
      expect(unknown.message).toBe('This code does not exist.');

      const notMet = await t.checkout.applyDiscount(s, { ...t.cart(), code: 'big' });
      expect(notMet).toMatchObject({ code: 'BIG', status: 'CONDITIONS_NOT_MET', applied: false });

      expect(saveCart).not.toHaveBeenCalled();
      expect(t.storedCart(token).promotionCodes).toEqual([]);
    });

    it('keeps the codes already in the cart and refuses more than five', async () => {
      const t = setup();
      t.addPromotion(1, { method: 'CODE', code: 'VERAO20' });
      const { token, s } = await t.open();
      const r = await t.checkout.applyDiscount(s, {
        ...t.cart({ promotionCodes: ['OUTRO'] }),
        code: 'VERAO20',
      });
      expect(r.applied).toBe(true);
      expect(t.storedCart(token).promotionCodes).toEqual(['OUTRO', 'VERAO20']);
      expect(
        await failure(
          t.checkout.applyDiscount(s, {
            ...t.cart({ promotionCodes: ['A', 'B', 'C', 'D', 'E'] }),
            code: 'VERAO20',
          })
        )
      ).toEqual([{ path: 'promotionCodes', code: 'too_many' }]);
      expect(await failure(t.checkout.applyDiscount(s, { ...t.cart(), code: 42 }))).toEqual([
        { path: 'code', code: 'invalid' },
      ]);
      expect(await failure(t.checkout.applyDiscount(s, { ...t.cart(), code: '   ' }))).toEqual([
        { path: 'code', code: 'required' },
      ]);
    });

    it('an empty cart: empty quote, not applied, nothing saved, no order-service call', async () => {
      const t = setup();
      t.addPromotion(1, { method: 'CODE', code: 'VERAO20' });
      const { token, s } = await t.open();
      const spy = vi.spyOn(t.c.orders, 'quote');
      const r = await t.checkout.applyDiscount(s, { ...t.cart({ lines: [] }), code: 'VERAO20' });
      expect(spy).not.toHaveBeenCalled();
      expect(r.applied).toBe(false);
      expect(r.quote.lines).toEqual([]);
      expect(r.quote.totals.total).toBe(0);
      expect(t.storedCart(token).promotionCodes).toEqual([]);
    });

    it('a code restricted to e-mails: EMAIL_NOT_VERIFIED, then applied after confirmEmailVerification and used by placeOrder', async () => {
      const t = setup();
      t.addPromotion(1, {
        method: 'CODE',
        code: 'VIP',
        eligibility: { mode: 'EMAILS', emails: ['ana@example.pt'] },
        benefits: { items: [{ type: 'ORDER_FIXED', amount: 500 }] },
      });
      const { token, s } = await t.open();
      const before = await t.checkout.applyDiscount(s, {
        ...t.cart({ email: 'ana@example.pt' }),
        code: 'VIP',
      });
      expect(before).toMatchObject({ status: 'EMAIL_NOT_VERIFIED', applied: false });

      vi.stubEnv('LTB_ECOMMERCE_ENCRYPTION_KEY', 'test-encryption-key-for-checkout');
      const c2 = t.c;
      c2.services.EcommerceSettingsService.getRuntime = async (id: string) =>
        id === 'resend'
          ? {
              config: { fromEmail: 'shop@example.pt', fromName: 'Shop' },
              secrets: { apiKey: 're_test_x' },
              active: true,
            }
          : null;
      const fetchMock = vi.fn(
        async (..._args: any[]) => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })
      );
      vi.stubGlobal('fetch', fetchMock);
      await t.sessions.requestEmailVerification(s, { email: 'Ana@Example.pt', locale: 'en' });
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      const code = JSON.parse(body.html).verification.code;
      await t.sessions.confirmEmailVerification(s, { email: 'Ana@Example.pt', code });
      const verified = await t.sessions.resolve(token);

      const after = await t.checkout.applyDiscount(verified, {
        ...t.cart({ email: 'ana@example.pt' }),
        code: 'VIP',
      });
      expect(after).toMatchObject({ status: 'APPLIED', applied: true });

      const placed = await t.checkout.placeOrder(
        verified,
        t.orderInput({ promotionCodes: ['VIP'], expectedTotal: 4000 }),
        'key-vip-0001'
      );
      expect(placed.total).toBe(4000);
      expect(t.c.tables[UIDS.promotionRedemption]).toEqual([
        expect.objectContaining({ promotion: 1, status: 'RESERVED' }),
      ]);
    });
  });

  describe('checkStoreCredit', () => {
    it('the right e-mail gets the balance; another e-mail → STORE_CREDIT_NOT_FOUND (Review Focus 4)', async () => {
      const t = setup();
      const issued = await t.issueCredit('ana@example.pt', 3000);
      t.c.tables[UIDS.storeCredit].find((x) => x.id === issued.id).expiresAt = null;
      expect(
        await t.checkout.checkStoreCredit({
          code: issued.code.toLowerCase(),
          email: 'Ana@Example.pt',
        })
      ).toEqual({ balance: 3000, expiresAt: null });
      expect(
        await failure(t.checkout.checkStoreCredit({ code: issued.code, email: 'rui@example.pt' }))
      ).toEqual([{ path: 'code', code: 'STORE_CREDIT_NOT_FOUND' }]);
      expect(
        await failure(
          t.checkout.checkStoreCredit({ code: 'ZZZZ-ZZZZ-ZZZZ', email: 'ana@example.pt' })
        )
      ).toEqual([{ path: 'code', code: 'STORE_CREDIT_NOT_FOUND' }]);
      expect(
        await failure(t.checkout.checkStoreCredit({ code: 7, email: 'ana@example.pt' }))
      ).toEqual([{ path: 'code', code: 'STORE_CREDIT_NOT_FOUND' }]);
    });

    it('an empty credit → STORE_CREDIT_EMPTY; the expiry is an ISO string', async () => {
      const t = setup();
      const issued = await t.issueCredit('ana@example.pt', 3000);
      const row = t.c.tables[UIDS.storeCredit].find((x) => x.id === issued.id);
      row.expiresAt = new Date('2099-01-01T00:00:00.000Z');
      expect(
        await t.checkout.checkStoreCredit({ code: issued.code, email: 'ana@example.pt' })
      ).toEqual({ balance: 3000, expiresAt: '2099-01-01T00:00:00.000Z' });
      row.balance = 0;
      expect(
        await failure(t.checkout.checkStoreCredit({ code: issued.code, email: 'ana@example.pt' }))
      ).toEqual([{ path: 'code', code: 'STORE_CREDIT_EMPTY' }]);
    });
  });

  describe('placeOrder', () => {
    it('Review Focus 1: the same key twice in one session → one order; in another session → its own order', async () => {
      const t = setup();
      const a = await t.open();
      const first = await t.checkout.placeOrder(a.s, t.orderInput(), 'dup-key-0001');
      const again = await t.checkout.placeOrder(a.s, t.orderInput(), 'dup-key-0001');
      expect(again).toEqual(first);
      expect(t.c.tables[UIDS.order]).toHaveLength(1);
      expect(deductions(t.c)).toHaveLength(1);
      expect(t.c.tables[UIDS.order][0].idempotencyKey).toBe(`sf:${a.s.id}:dup-key-0001`);

      const b = await t.open();
      const other = await t.checkout.placeOrder(b.s, t.orderInput(), 'dup-key-0001');
      expect(other.publicId).not.toBe(first.publicId);
      expect(JSON.stringify(other)).not.toContain(first.publicId);
      expect(t.c.tables[UIDS.order]).toHaveLength(2);
      expect(deductions(t.c)).toHaveLength(2);
    });

    it('returns the public fields only, links the session, sets the storefront actor and clears the cart', async () => {
      const t = setup();
      const { token, s } = await t.open();
      await t.checkout.quote(
        s,
        t.cart({ email: 'ana@example.pt', destination: { country: 'PT' }, promotionCodes: ['X'] })
      );
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000001');
      expect(r).toEqual({
        publicId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        reference: '#1001',
        total: 4500,
        due: 4500,
        paymentStatus: 'PENDING',
      });
      const order = t.c.tables[UIDS.order][0];
      expect(order).toMatchObject({ checkoutSession: s.id, source: 'storefront' });
      expect(order.billingAddress).toEqual(order.shippingAddress);
      expect(t.storedCart(token)).toMatchObject({
        lines: [],
        promotionCodes: [],
        email: 'ana@example.pt',
        destination: { country: 'PT' },
      });
    });

    it('a failing clearCart is only logged', async () => {
      const t = setup();
      const { s } = await t.open();
      vi.spyOn(t.sessions, 'clearCart').mockRejectedValue(new Error('db down'));
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000002');
      expect(r.reference).toBe('#1001');
      expect(t.c.log.error).toHaveBeenCalledWith(
        '[ecommerce:storefront] cart clear failed after order: db down'
      );
    });

    it('a session that expired (or is no longer ACTIVE) since it was resolved → SESSION_INVALID, nothing created', async () => {
      const t = setup();
      const { token, s } = await t.open();
      const row = t.c.tables[UIDS.checkoutSession].find((r) => r.tokenHash === sha(token));
      row.expiresAt = new Date(Date.now() - 1000);
      expect(await failure(t.checkout.placeOrder(s, t.orderInput(), 'key-0000003'))).toEqual([
        { path: 'session', code: 'SESSION_INVALID' },
      ]);
      row.expiresAt = new Date(Date.now() + 3_600_000);
      row.status = 'EXPIRED';
      expect(await failure(t.checkout.placeOrder(s, t.orderInput(), 'key-0000003'))).toEqual([
        { path: 'session', code: 'SESSION_INVALID' },
      ]);
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
    });

    it('validates the Idempotency-Key and expectedTotal', async () => {
      const t = setup();
      const { s } = await t.open();
      expect(await failure(t.checkout.placeOrder(s, t.orderInput(), ''))).toEqual([
        { path: 'idempotencyKey', code: 'required' },
      ]);
      expect(await failure(t.checkout.placeOrder(s, t.orderInput(), 'k'.repeat(151)))).toEqual([
        { path: 'idempotencyKey', code: 'too_long' },
      ]);
      expect(
        await failure(
          t.checkout.placeOrder(s, t.orderInput({ expectedTotal: undefined }), 'key-0000004')
        )
      ).toEqual([{ path: 'expectedTotal', code: 'required' }]);
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
    });

    it('a different expectedTotal → TOTAL_CHANGED, nothing created', async () => {
      const t = setup();
      const { s } = await t.open();
      const errors = await failure(
        t.checkout.placeOrder(s, t.orderInput({ expectedTotal: 4400 }), 'key-0000005')
      );
      expect(errors.map((e: any) => e.code)).toEqual(['TOTAL_CHANGED']);
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
      expect(deductions(t.c)).toHaveLength(0);
    });

    it('emailVerified is the session verification of the exact normalised e-mail', async () => {
      const t = setup();
      const { token } = await t.open();
      const s = await t.verify(token, 'ana@example.pt');
      const spy = vi.spyOn(t.c.orders, 'create');
      await t.checkout.placeOrder(
        s,
        { ...t.orderInput(), emailVerified: false } as any,
        'key-0000006'
      );
      expect(spy.mock.calls[0][0]).toMatchObject({ emailVerified: true });
      expect(spy.mock.calls[0][1]).toEqual({
        actor: 'storefront',
        source: 'storefront',
        checkoutSessionId: s.id,
      });
      await t.checkout.placeOrder(
        s,
        t.orderInput({ customer: { firstName: 'Rui', lastName: 'S', email: 'rui@example.pt' } }),
        'key-0000007'
      );
      expect(spy.mock.calls[1][0]).toMatchObject({ emailVerified: false });
    });

    it("Review Focus 4: another e-mail's store credit → STORE_CREDIT_NOT_FOUND on storeCreditCode, nothing created", async () => {
      const t = setup();
      const issued = await t.issueCredit('rui@example.pt', 3000);
      const { s } = await t.open();
      expect(
        await failure(
          t.checkout.placeOrder(s, t.orderInput({ storeCreditCode: issued.code }), 'key-0000008')
        )
      ).toEqual([{ path: 'storeCreditCode', code: 'STORE_CREDIT_NOT_FOUND' }]);
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
      expect(deductions(t.c)).toHaveLength(0);
      expect(t.c.tables[UIDS.storeCredit].find((x) => x.id === issued.id).balance).toBe(3000);
    });

    it("a customer's store credit pays the order without a verified e-mail", async () => {
      const t = setup();
      const issued = await t.issueCredit('ana@example.pt', 1000);
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(
        s,
        t.orderInput({ storeCreditCode: issued.code }),
        'key-0000009'
      );
      expect(r).toMatchObject({ total: 4500, due: 3500, paymentStatus: 'PARTIALLY_PAID' });
      expect(t.c.tables[UIDS.payment]).toEqual([
        expect.objectContaining({ method: 'STORE_CREDIT', status: 'COMPLETED', amount: 1000 }),
      ]);
    });

    it('a credit that covers everything → due 0, PAID; paymentLink → NOTHING_DUE', async () => {
      const t = setup();
      const issued = await t.issueCredit('ana@example.pt', 8000);
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(
        s,
        t.orderInput({ storeCreditCode: issued.code }),
        'key-0000010'
      );
      expect(r).toMatchObject({ total: 4500, due: 0, paymentStatus: 'PAID' });
      const err = await t.checkout.paymentLink(s, r.publicId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EcommercePaymentError);
      expect(err.code).toBe('NOTHING_DUE');
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('creates the customer by the normalised e-mail or reuses it; same response shape', async () => {
      const t = setup();
      const a = await t.open();
      const first = await t.checkout.placeOrder(
        a.s,
        t.orderInput({
          customer: { firstName: 'Ana', lastName: 'Silva', email: ' ANA@example.PT ' },
        }),
        'key-0000011'
      );
      const b = await t.open();
      const second = await t.checkout.placeOrder(b.s, t.orderInput(), 'key-0000012');
      const customers = t.c.tables[UIDS.customer];
      expect(customers).toHaveLength(1);
      expect(customers[0].emailNormalized).toBe('ana@example.pt');
      expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
      expect({ ...first, publicId: 'x', reference: 'x' }).toEqual({
        ...second,
        publicId: 'x',
        reference: 'x',
      });
    });

    it('Review Focus 3: after the session expires the order stays OPEN/PENDING with stock and promotion reserved', async () => {
      const t = setup();
      t.addPromotion(1, { method: 'CODE', code: 'VERAO20', usageLimit: 10 });
      const { token, s } = await t.open();
      const r = await t.checkout.placeOrder(
        s,
        t.orderInput({ promotionCodes: ['VERAO20'], expectedTotal: 4100 }),
        'key-0000013'
      );
      const row = t.c.tables[UIDS.checkoutSession].find((x) => x.tokenHash === sha(token));
      row.expiresAt = new Date(Date.now() - 1000);
      expect(await t.sessions.resolve(token)).toBeNull();
      const order = t.c.tables[UIDS.order].find((o) => o.publicId === r.publicId);
      expect(order).toMatchObject({ orderStatus: 'OPEN', paymentStatus: 'PENDING' });
      expect(t.c.tables[UIDS.variant].find((v) => v.id === 10).stock).toBe(3);
      expect(t.c.tables[UIDS.promotionRedemption]).toEqual([
        expect.objectContaining({ promotion: 1, status: 'RESERVED' }),
      ]);
    });
  });

  describe('paymentLink', () => {
    it('twice → the same Stripe URL, reused on the second; only the four public fields', async () => {
      const t = setup();
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000020');
      const first = await t.checkout.paymentLink(s, r.publicId);
      // The reused session is confirmed with the current Stripe keys.
      stripe.retrieveCheckoutSession.mockResolvedValueOnce({
        id: 'cs_1',
        status: 'open',
        paymentStatus: 'unpaid',
        paymentIntentId: null,
        amountTotal: 4500,
        metadata: {},
      });
      const second = await t.checkout.paymentLink(s, r.publicId);
      expect(first).toEqual({
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        expiresAt: expect.any(String),
        amount: 4500,
        reused: false,
      });
      expect(second).toEqual({ ...first, reused: true });
      expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(second)).not.toMatch(/\/admin|littlebox-strapi-suite/);
    });

    it("Review Focus 2: another session's publicId → EcommerceNotFoundError, no Stripe call", async () => {
      const t = setup();
      const a = await t.open();
      const b = await t.open();
      const r = await t.checkout.placeOrder(a.s, t.orderInput(), 'key-0000021');
      await expect(t.checkout.paymentLink(b.s, r.publicId)).rejects.toBeInstanceOf(
        EcommerceNotFoundError
      );
      await expect(t.checkout.orderStatus(b.s, r.publicId)).rejects.toBeInstanceOf(
        EcommerceNotFoundError
      );
      await expect(
        t.checkout.orderStatus(b.s, '00000000-0000-4000-8000-000000000000')
      ).rejects.toBeInstanceOf(EcommerceNotFoundError);
      await expect(
        t.checkout.paymentLink(b.s, '00000000-0000-4000-8000-000000000000')
      ).rejects.toBeInstanceOf(EcommerceNotFoundError);
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      expect(t.c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] ORDER_ACCESS_DENIED');
    });
  });

  describe('orderStatus', () => {
    it('UNPAID with an OPEN session, PROCESSING once the session is COMPLETE and the payment PENDING', async () => {
      const t = setup();
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000030');
      await t.checkout.paymentLink(s, r.publicId);
      expect((await t.checkout.orderStatus(s, r.publicId)).paymentResult).toBe('UNPAID');
      t.c.tables[UIDS.stripeSession][0].status = 'COMPLETE';
      const st = await t.checkout.orderStatus(s, r.publicId);
      expect(st.paymentResult).toBe('PROCESSING');
      for (const key of [
        'shipments',
        'returns',
        'invoices',
        'history',
        'payments',
        'customer',
        'id',
        'billing',
      ]) {
        expect(st).not.toHaveProperty(key);
      }
    });

    it('PAID after the checkout.session.completed webhook; promotions with the order locale displayName and amount', async () => {
      const t = setup();
      t.addPromotion(1, {
        name: 'Interno',
        displayName: { pt: 'Verão', en: 'Summer' },
        benefits: { items: [{ type: 'ORDER_FIXED', amount: 500 }] },
      });
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(
        s,
        t.orderInput({ locale: 'pt', expectedTotal: 4000 }),
        'key-0000031'
      );
      const link = await t.checkout.paymentLink(s, r.publicId);
      const order = t.c.tables[UIDS.order][0];
      const payment = t.c.tables[UIDS.payment].find((p) => p.method === 'STRIPE');
      const { raw, signature } = signed({
        id: 'evt_1',
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            object: 'checkout.session',
            status: 'complete',
            payment_status: 'paid',
            payment_intent: 'pi_1',
            amount_total: link.amount,
            metadata: {
              orderId: String(order.id),
              paymentId: String(payment.id),
              purpose: 'CHECKOUT',
            },
          },
        },
      });
      expect(await t.c.webhooks.handle(raw, signature)).toEqual({
        duplicate: false,
        status: 'PROCESSED',
      });

      const st = await t.checkout.orderStatus(s, r.publicId);
      expect(st).toMatchObject({
        publicId: r.publicId,
        reference: '#1001',
        locale: 'pt',
        orderStatus: 'OPEN',
        paymentStatus: 'PAID',
        paymentResult: 'PAID',
        currency: 'EUR',
        promotions: [{ name: 'Verão', amount: 500 }],
        shipping: { name: 'Standard' },
      });
      expect(st.totals).toMatchObject({ total: 4000, paid: 4000, due: 0 });
      expect(st.lines).toEqual([
        {
          name: 'Shirt',
          option: null,
          sku: 'SH-M',
          quantity: 2,
          unitPrice: 2000,
          unitDiscount: 0,
          total: 4000,
          isGift: false,
        },
      ]);
      expect(JSON.stringify(st)).not.toContain('Interno');
    });

    it('does not load shipments, returns, invoices or notifications (no get())', async () => {
      const t = setup();
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000032');
      const get = vi.spyOn(t.c.orders, 'get');
      await t.checkout.orderStatus(s, r.publicId);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('fix round 1', () => {
    it('F1: placeOrder caps the quantity per line at 1000, like quote', async () => {
      const t = setup();
      const { s } = await t.open();
      expect(
        await failure(
          t.checkout.placeOrder(
            s,
            t.orderInput({ lines: [{ variantId: 10, quantity: 1001 }] }),
            'key-0000050'
          )
        )
      ).toEqual([{ path: 'lines.0.quantity', code: 'invalid' }]);
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
    });

    it('F2: a replay never clears the cart rebuilt since the order', async () => {
      const t = setup();
      const { token, s } = await t.open();
      const first = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000051');
      await t.checkout.quote(
        s,
        t.cart({ lines: [{ variantId: 10, quantity: 1 }], promotionCodes: ['X'] })
      );
      const clearCart = vi.spyOn(t.sessions, 'clearCart');
      const again = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000051');
      expect(again).toEqual(first);
      expect(clearCart).not.toHaveBeenCalled();
      expect(t.storedCart(token)).toMatchObject({
        lines: [{ variantId: 10, quantity: 1 }],
        promotionCodes: ['X'],
      });
    });

    it('F3: an AWAITING_SHIPPING code is saved (not applied)', async () => {
      const t = setup();
      t.addPromotion(1, {
        method: 'CODE',
        code: 'PORTES',
        benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
      });
      const { token, s } = await t.open();
      const r = await t.checkout.applyDiscount(s, { ...t.cart(), code: 'portes' });
      expect(r).toMatchObject({ code: 'PORTES', status: 'AWAITING_SHIPPING', applied: false });
      expect(t.storedCart(token).promotionCodes).toEqual(['PORTES']);
    });

    it('F5: createdAt is an ISO string, or null when missing', async () => {
      const t = setup();
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000052');
      expect((await t.checkout.orderStatus(s, r.publicId)).createdAt).toBeNull();
      t.c.tables[UIDS.order][0].createdAt = new Date('2026-11-11T10:00:00.000Z');
      expect((await t.checkout.orderStatus(s, r.publicId)).createdAt).toBe(
        '2026-11-11T10:00:00.000Z'
      );
    });
  });

  describe('hasPendingCompletedStripeSession', () => {
    it('true only for a COMPLETE session whose STRIPE payment is PENDING', async () => {
      const t = setup();
      const { s } = await t.open();
      const r = await t.checkout.placeOrder(s, t.orderInput(), 'key-0000040');
      const svc = t.c.services.EcommerceStripePaymentService;
      const orderId = t.c.tables[UIDS.order][0].id;
      expect(await svc.hasPendingCompletedStripeSession(orderId)).toBe(false);
      await t.checkout.paymentLink(s, r.publicId);
      expect(await svc.hasPendingCompletedStripeSession(orderId)).toBe(false);
      const session = t.c.tables[UIDS.stripeSession][0];
      session.status = 'COMPLETE';
      expect(await svc.hasPendingCompletedStripeSession(orderId)).toBe(true);
      t.c.tables[UIDS.payment].find((p) => p.method === 'STRIPE').status = 'COMPLETED';
      expect(await svc.hasPendingCompletedStripeSession(orderId)).toBe(false);
    });
  });
});
