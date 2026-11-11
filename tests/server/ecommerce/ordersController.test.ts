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

  it('applyModification splits operationId from the input', async () => {
    const applyModification = vi.fn().mockResolvedValue({ order: {} });
    const c = orders({ EcommerceOrderService: { applyModification } });
    const ctx = mkCtx({
      params: { id: '3' },
      request: { body: { operationId: 'op-12345678', lines: [], shipping: { mode: 'KEEP' } } },
    });
    await c.applyModification(ctx);
    expect(applyModification).toHaveBeenCalledWith(
      3,
      { lines: [], shipping: { mode: 'KEEP' } },
      'user:7',
      'op-12345678'
    );
  });

  it('previewModification, shippingQuote and variantSearch delegate', async () => {
    const previewModification = vi.fn().mockResolvedValue({ p: 1 });
    const quoteForLines = vi.fn().mockResolvedValue({ options: [] });
    const searchVariants = vi.fn().mockResolvedValue([]);
    const c = orders({ EcommerceOrderService: { previewModification, quoteForLines, searchVariants } });
    await c.previewModification(mkCtx({ params: { id: '2' }, request: { body: { lines: [] } } }));
    expect(previewModification).toHaveBeenCalledWith(2, { lines: [] });
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
