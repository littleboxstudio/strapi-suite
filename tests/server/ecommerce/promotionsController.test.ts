import { describe, expect, it, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createPromotions from '../../../server/src/controllers/modules/ecommerce/promotions';

const strapiWith = (services: Record<string, any>) =>
  ({ plugin: () => ({ service: (n: string) => services[n] }) }) as any;
const promos = (s: Record<string, any>) =>
  createPromotions({ strapi: strapiWith({ EcommercePromotionService: s }) });

const mkCtx = (extra: any = {}): any => ({
  params: {},
  query: {},
  request: { body: {} },
  state: { user: { id: 7 } },
  badRequest: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});
const fails = (code: string, path = 'x') => new EcommerceValidationError('bad', [{ path, code }]);

describe('EcommercePromotionController', () => {
  it('list parses the page strictly and caps the search at 100', async () => {
    const list = vi.fn().mockResolvedValue({ results: [], pagination: {} });
    const c = promos({ list });
    const ctx = mkCtx({ query: { page: '3', search: 'summer' } });
    await c.list(ctx);
    expect(list).toHaveBeenCalledWith({ page: 3, search: 'summer' });
    expect(ctx.body).toEqual({ results: [], pagination: {} });
    const none = mkCtx();
    await c.list(none);
    expect(list).toHaveBeenLastCalledWith({ page: 1, search: undefined });
    const long = mkCtx({ query: { search: 'x'.repeat(101) } });
    await c.list(long);
    expect(long.badRequest).toHaveBeenCalledWith('Invalid promotion', expect.objectContaining({ code: 'too_long' }));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each(['2abc', '0', '-1', '1.5', '', ' 2', '9'.repeat(16)])('rejects page=%s with 400 Invalid page', async (page) => {
    const svc = { list: vi.fn(), listRedemptions: vi.fn() };
    const c = promos(svc);
    for (const [fn, params] of [[c.list, {}], [c.listRedemptions, { id: '4' }]] as const) {
      const ctx = mkCtx({ params, query: { page } });
      await fn(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith('Invalid page');
    }
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.listRedemptions).not.toHaveBeenCalled();
  });

  it('create passes the body and the actor and answers 201', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = mkCtx({ request: { body: { name: 'A' } } });
    await promos({ create }).create(ctx);
    expect(create).toHaveBeenCalledWith({ name: 'A' }, 'user:7');
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 1 });
  });

  it('an invalid definition is a 400 with errors', async () => {
    const create = vi.fn().mockRejectedValue(fails('required', 'name'));
    const ctx = mkCtx();
    await promos({ create }).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid promotion', {
      code: 'required',
      errors: [{ path: 'name', code: 'required' }],
    });
  });

  it.each(['PROMOTION_IN_USE', 'PROMOTION_VERSION_CONFLICT'])('%s is a 409', async (code) => {
    const op = vi.fn().mockRejectedValue(fails(code));
    const c = promos({ update: op, remove: op });
    for (const [fn, ctx] of [
      [c.update, mkCtx({ params: { id: '4' }, request: { body: { version: 1 } } })],
      [c.remove, mkCtx({ params: { id: '4' } })],
    ] as const) {
      await fn(ctx);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details.code).toBe(code);
    }
  });

  it('get, update, remove and listRedemptions reject bad ids and never call the service', async () => {
    const svc = { get: vi.fn(), update: vi.fn(), remove: vi.fn(), listRedemptions: vi.fn() };
    const c = promos(svc);
    for (const id of ['0', '-1', '1.5', '1e3', 'abc', '', ' 2', '9'.repeat(16)]) {
      for (const fn of [c.get, c.update, c.remove, c.listRedemptions]) {
        const ctx = mkCtx({ params: { id } });
        await fn(ctx);
        expect(ctx.badRequest).toHaveBeenCalledWith('Invalid id');
      }
    }
    expect(svc.get).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.remove).not.toHaveBeenCalled();
    expect(svc.listRedemptions).not.toHaveBeenCalled();
  });

  it('get returns the view and a missing promotion is a 404', async () => {
    const get = vi.fn().mockResolvedValueOnce({ id: 4 }).mockRejectedValueOnce(new EcommerceNotFoundError('x'));
    const c = promos({ get });
    const ok = mkCtx({ params: { id: '4' } });
    await c.get(ok);
    expect(get).toHaveBeenCalledWith(4);
    expect(ok.body).toEqual({ id: 4 });
    const missing = mkCtx({ params: { id: '4' } });
    await c.get(missing);
    expect(missing.notFound).toHaveBeenCalledWith('Promotion not found');
  });

  it('update passes id, body and actor', async () => {
    const update = vi.fn().mockResolvedValue({ id: 4, version: 2 });
    const ctx = mkCtx({ params: { id: '4' }, request: { body: { name: 'B', version: 1 } } });
    await promos({ update }).update(ctx);
    expect(update).toHaveBeenCalledWith(4, { name: 'B', version: 1 }, 'user:7');
    expect(ctx.body).toEqual({ id: 4, version: 2 });
  });

  it('remove answers { ok: true }', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const ctx = mkCtx({ params: { id: '4' } });
    await promos({ remove }).remove(ctx);
    expect(remove).toHaveBeenCalledWith(4, 'user:7');
    expect(ctx.body).toEqual({ ok: true });
  });

  it('listRedemptions passes the page and returns the service view as is', async () => {
    const page = { results: [{ id: 1, email: 'a@b.pt' }], pagination: {} };
    const listRedemptions = vi.fn().mockResolvedValue(page);
    const ctx = mkCtx({ params: { id: '4' }, query: { page: '2' } });
    await promos({ listRedemptions }).listRedemptions(ctx);
    expect(listRedemptions).toHaveBeenCalledWith(4, { page: 2 });
    expect(ctx.body).toBe(page);
  });

  it('catalogSearch passes q and locale', async () => {
    const catalogSearch = vi.fn().mockResolvedValue([]);
    const ctx = mkCtx({ query: { q: 'sock', locale: 'pt' } });
    await promos({ catalogSearch }).catalogSearch(ctx);
    expect(catalogSearch).toHaveBeenCalledWith('sock', 'pt');
    const none = mkCtx();
    await promos({ catalogSearch }).catalogSearch(none);
    expect(catalogSearch).toHaveBeenLastCalledWith('', undefined);
  });
});
