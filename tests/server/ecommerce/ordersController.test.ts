import { describe, expect, it, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createOrders from '../../../server/src/controllers/modules/ecommerce/orders';
import createCustomers from '../../../server/src/controllers/modules/ecommerce/customers';

const strapiWith = (services: Record<string, any>, controllers: Record<string, any> = {}) =>
  ({
    plugin: () => ({
      service: (n: string) => services[n],
      controller: (n: string) => controllers[n],
    }),
  }) as any;
const orders = (s: Record<string, any>, c: Record<string, any> = {}) =>
  createOrders({ strapi: strapiWith(s, c) });
const customers = (s: Record<string, any>) => createCustomers({ strapi: strapiWith(s) });

const mkCtx = (extra: any = {}): any => ({
  params: {},
  query: {},
  request: { body: {} },
  state: { user: { id: 7 } },
  badRequest: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});

describe('EcommerceOrderController', () => {
  it('rejects a non-numeric id with 400 without calling the service', async () => {
    const get = vi.fn();
    const c = orders({ EcommerceOrderService: { get } });
    const ctx = mkCtx({ params: { id: 'abc' } });
    await c.get(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('maps validation and not found errors', async () => {
    const errors = [{ path: 'x', code: 'required' }];
    const c = orders({
      EcommerceOrderService: {
        get: vi.fn().mockRejectedValue(new EcommerceNotFoundError('x')),
        cancel: vi.fn().mockRejectedValue(new EcommerceValidationError('x', errors)),
      },
    });
    const a = mkCtx({ params: { id: '1' } });
    await c.get(a);
    expect(a.notFound).toHaveBeenCalled();
    const b = mkCtx({ params: { id: '1' } });
    await c.cancel(b);
    expect(b.badRequest).toHaveBeenCalledWith(expect.any(String), { errors });
  });

  it('create requires idempotencyKey and passes actor and source', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const c = orders({ EcommerceOrderService: { create } });
    const bad = mkCtx({ request: { body: { lines: [] } } });
    await c.create(bad);
    expect(bad.badRequest).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    const ctx = mkCtx({ request: { body: { idempotencyKey: 'k1' } } });
    await c.create(ctx);
    expect(create).toHaveBeenCalledWith({ idempotencyKey: 'k1' }, { actor: 'user:7', source: 'admin' });
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 1 });
  });

  it('cancel and archive use the actor', async () => {
    const cancel = vi.fn().mockResolvedValue({ ok: 1 });
    const archive = vi.fn().mockResolvedValue({ ok: 2 });
    const c = orders({ EcommerceOrderService: { cancel, archive } });
    await c.cancel(mkCtx({ params: { id: '5' } }));
    await c.archive(mkCtx({ params: { id: '5' } }));
    expect(cancel).toHaveBeenCalledWith(5, 'user:7');
    expect(archive).toHaveBeenCalledWith(5, 'user:7');
  });

  it('addPayment forwards the body fields and actor', async () => {
    const addManualPayment = vi.fn().mockResolvedValue({ id: 1 });
    const c = orders({ EcommercePaymentService: { addManualPayment } });
    const ctx = mkCtx({
      params: { id: '3' },
      request: { body: { amount: 500, reference: 'r', methodLabel: 'MB', idempotencyKey: 'abcdefgh', extra: 1 } },
    });
    await c.addPayment(ctx);
    expect(addManualPayment).toHaveBeenCalledWith(
      3,
      { amount: 500, reference: 'r', methodLabel: 'MB', idempotencyKey: 'abcdefgh' },
      'user:7'
    );
    expect(ctx.status).toBe(201);
  });

  it('addPayment refuses a methodLabel above 255 characters without calling the service', async () => {
    const addManualPayment = vi.fn();
    const c = orders({ EcommercePaymentService: { addManualPayment } });
    const ctx = mkCtx({
      params: { id: '3' },
      request: { body: { amount: 500, methodLabel: 'x'.repeat(256), idempotencyKey: 'abcdefgh' } },
    });
    await c.addPayment(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errors: [{ path: 'methodLabel', code: 'too_long' }] })
    );
    expect(addManualPayment).not.toHaveBeenCalled();
  });

  it('shippingQuote and variantSearch delegate', async () => {
    const quoteForLines = vi.fn().mockResolvedValue({ options: [] });
    const searchVariants = vi.fn().mockResolvedValue([]);
    const c = orders({ EcommerceOrderService: { quoteForLines, searchVariants } });
    await c.shippingQuote(
      mkCtx({ request: { body: { country: 'PT', postalCode: '1000', lines: [], locale: 'en', junk: 1 } } })
    );
    expect(quoteForLines).toHaveBeenCalledWith({ country: 'PT', postalCode: '1000', lines: [], locale: 'en' });
    await c.variantSearch(mkCtx({ query: { q: 'abc', locale: 'pt' } }));
    expect(searchVariants).toHaveBeenCalledWith('abc', 'pt');
  });

  it('list passes the filters', async () => {
    const list = vi.fn().mockResolvedValue({ results: [] });
    const c = orders({ EcommerceOrderService: { list } });
    await c.list(mkCtx({ query: { page: '2', search: '#1', orderStatus: 'OPEN' } }));
    expect(list).toHaveBeenCalledWith({
      page: 2,
      search: '#1',
      orderStatus: 'OPEN',
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
    });
  });

  it('getLocales reuses the products controller', async () => {
    const getLocales = vi.fn(async (ctx: any) => {
      ctx.body = { defaultLocale: 'en' };
    });
    const c = orders({}, { EcommerceProductController: { getLocales } });
    const ctx = mkCtx();
    await c.getLocales(ctx);
    expect(ctx.body).toEqual({ defaultLocale: 'en' });
  });
});

describe('EcommerceCustomerController', () => {
  it('validates ids, uses the actor and maps errors', async () => {
    const update = vi.fn().mockResolvedValue({ id: 4 });
    const get = vi.fn().mockRejectedValue(new EcommerceNotFoundError('x'));
    const c = customers({ EcommerceCustomerService: { update, get } });

    const bad = mkCtx({ params: { id: 'x' } });
    await c.get(bad);
    expect(bad.badRequest).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();

    const nf = mkCtx({ params: { id: '9' } });
    await c.get(nf);
    expect(nf.notFound).toHaveBeenCalled();

    const ctx = mkCtx({ params: { id: '4' }, request: { body: { firstName: 'A' } } });
    await c.update(ctx);
    expect(update).toHaveBeenCalledWith(4, { firstName: 'A' }, 'user:7');
    expect(ctx.body).toEqual({ id: 4 });
  });

  it('lists customers and their orders', async () => {
    const list = vi.fn().mockResolvedValue({ results: [] });
    const listOrders = vi.fn().mockResolvedValue({ results: [] });
    const lastOrderAddresses = vi.fn().mockResolvedValue(null);
    const c = customers({ EcommerceCustomerService: { list, listOrders, lastOrderAddresses } });
    await c.list(mkCtx({ query: { page: '3', search: 'a@b' } }));
    expect(list).toHaveBeenCalledWith({ page: 3, search: 'a@b' });
    await c.listOrders(mkCtx({ params: { id: '2' }, query: { search: '#1001' } }));
    expect(listOrders).toHaveBeenCalledWith(2, { page: 1, search: '#1001' });
    const ctx = mkCtx({ params: { id: '2' } });
    await c.lastAddresses(ctx);
    expect(ctx.body).toEqual({ shippingAddress: null, billingAddress: null });
  });
});

describe('EcommerceOrderController promotions', () => {
  const run = async (method: 'create' | 'quote', body: any, service: any) => {
    const c = orders({ EcommerceOrderService: service });
    const ctx = mkCtx({ request: { body: { idempotencyKey: 'k', ...body } } });
    await c[method](ctx);
    return ctx;
  };

  it('create strips storeCreditCode (storefront only)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const c = orders({ EcommerceOrderService: { create } });
    const ctx = mkCtx({
      request: { body: { idempotencyKey: 'k1', storeCreditCode: 'AAAA-BBBB-CCCC' } },
    });
    await c.create(ctx);
    expect(create).toHaveBeenCalledWith(
      { idempotencyKey: 'k1' },
      { actor: 'user:7', source: 'admin' }
    );
  });

  it('create passes promotionCodes, expectedTotal and giftChoices', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const body = { promotionCodes: ['SUMMER'], expectedTotal: 1000, giftChoices: { '3': 40 } };
    const ctx = await run('create', body, { create });
    expect(create).toHaveBeenCalledWith(
      { idempotencyKey: 'k', ...body },
      { actor: 'user:7', source: 'admin' }
    );
    expect(ctx.status).toBe(201);
  });

  it.each([
    ['six codes', { promotionCodes: ['A', 'B', 'C', 'D', 'E', 'F'] }, 'promotionCodes', 'too_many'],
    ['codes not a list', { promotionCodes: 'A' }, 'promotionCodes', 'invalid'],
    ['non-string code', { promotionCodes: [1] }, 'promotionCodes.0', 'invalid'],
    ['41-char code', { promotionCodes: ['x'.repeat(41)] }, 'promotionCodes.0', 'too_long'],
    ['negative total', { expectedTotal: -1 }, 'expectedTotal', 'invalid_amount'],
    ['fractional total', { expectedTotal: 1.5 }, 'expectedTotal', 'invalid_amount'],
    ['total above the cap', { expectedTotal: 1e9 + 1 }, 'expectedTotal', 'invalid_amount'],
    ['total as string', { expectedTotal: '10' }, 'expectedTotal', 'invalid_amount'],
    ['gift choices as list', { giftChoices: [1] }, 'giftChoices', 'invalid'],
    ['eleven gift choices', { giftChoices: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, 1])) }, 'giftChoices', 'too_many'],
    ['gift key not an id', { giftChoices: { a: 1 } }, 'giftChoices.a', 'invalid'],
    ['gift key with leading zero', { giftChoices: { '01': 1 } }, 'giftChoices.01', 'invalid'],
    ['gift key zero', { giftChoices: { '0': 1 } }, 'giftChoices.0', 'invalid'],
    ['gift key signed', { giftChoices: { '-1': 1 } }, 'giftChoices.-1', 'invalid'],
    ['gift value zero', { giftChoices: { '1': 0 } }, 'giftChoices.1', 'invalid'],
  ])('create and quote reject %s with 400 before the service', async (_n, extra, path, code) => {
    const create = vi.fn();
    const quote = vi.fn();
    for (const m of ['create', 'quote'] as const) {
      const ctx = await run(m, extra, { create, quote });
      expect(ctx.badRequest).toHaveBeenCalledWith('Invalid order', {
        code,
        errors: [{ path, code }],
      });
    }
    expect(create).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
  });

  it('accepts five codes of 40 characters and ten gift choices', async () => {
    const quote = vi.fn().mockResolvedValue({});
    const giftChoices = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1]));
    const ctx = await run(
      'quote',
      { promotionCodes: Array(5).fill('x'.repeat(40)), expectedTotal: 0, giftChoices },
      { quote }
    );
    expect(ctx.badRequest).not.toHaveBeenCalled();
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it('the admin quote allows manual line discounts (spec 4.1)', async () => {
    const quote = vi.fn().mockResolvedValue({});
    await run('quote', { lines: [{ variantId: 1, quantity: 1, discountPercent: 10 }] }, { quote });
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [{ variantId: 1, quantity: 1, discountPercent: 10 }] }),
      { manualDiscounts: true }
    );
  });

  it('create PROMOTION_UNAVAILABLE is a 409 carrying the code as detail', async () => {
    const err = new EcommerceValidationError('x', [
      { path: 'promotions.7', code: 'PROMOTION_UNAVAILABLE', detail: 'SUMMER' },
    ]);
    const ctx = await run('create', {}, { create: vi.fn().mockRejectedValue(err) });
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('PROMOTION_UNAVAILABLE');
    expect(ctx.body.error.details.errors[0].detail).toBe('SUMMER');
  });

  it.each([
    ['TOTAL_CHANGED', 'expectedTotal', 409],
    ['STORE_CREDIT_INSUFFICIENT', 'x', 409],
    ['PROMOTION_CODE_INVALID', 'promotionCodes.0', 400],
    ['invalid', 'promotionCodes.0', 400],
    ['too_many', 'promotionCodes', 400],
    ['invalid_email', 'email', 400],
    ['invalid_country', 'shipping.country', 400],
    ['required', 'shipping.country', 400],
    ['INSUFFICIENT_STOCK', 'gifts.30', 400],
  ])('service error %s maps to %s status', async (code, path, status) => {
    const err = new EcommerceValidationError('x', [{ path, code }]);
    for (const m of ['create', 'quote'] as const) {
      const ctx = await run(m, {}, { create: vi.fn().mockRejectedValue(err), quote: vi.fn().mockRejectedValue(err) });
      if (status === 409) {
        expect(ctx.status).toBe(409);
        expect(ctx.body.error.details.code).toBe(code);
      } else {
        expect(ctx.badRequest).toHaveBeenCalledWith('Invalid order', { code, errors: [{ path, code }] });
      }
    }
  });

  it('quote returns codes and totals from the service without an idempotency key', async () => {
    const result = { codes: [{ code: 'SUMMER', status: 'APPLIED' }], totals: { total: 900 } };
    const quote = vi.fn().mockResolvedValue(result);
    const c = orders({ EcommerceOrderService: { quote } });
    const ctx = mkCtx({ request: { body: { lines: [], promotionCodes: ['SUMMER'] } } });
    await c.quote(ctx);
    expect(quote).toHaveBeenCalledWith(
      { lines: [], promotionCodes: ['SUMMER'] },
      { manualDiscounts: true }
    );
    expect(ctx.body).toEqual(result);
    expect(ctx.body.codes).toBeDefined();
    expect(ctx.body.totals).toBeDefined();
  });
});
