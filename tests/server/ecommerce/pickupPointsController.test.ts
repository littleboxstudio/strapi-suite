import { describe, it, expect, vi } from 'vitest';
import createStorefront from '../../../server/src/controllers/modules/ecommerce/storefront';
import createOrders from '../../../server/src/controllers/modules/ecommerce/orders';
import { EcommerceCarrierError, EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';

const POINT = {
  id: 'PT1',
  name: 'Loja',
  address: 'Rua A 1',
  address2: null,
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  openingHours: [],
};
const SESSION = { id: 5, expiresAt: '2026-11-15T12:00:00Z', emailVerification: null, cart: null };

const strapiWith = (services: Record<string, any>) =>
  ({
    plugin: () => ({ service: (n: string) => services[n] }),
    log: { warn: vi.fn() },
  }) as any;

const sfCtx = (query: any, session = 'tok'): any => ({
  query,
  request: { headers: session ? { 'x-checkout-session': session } : {}, body: {} },
  set: vi.fn(),
});

const storefront = (search: any, resolve: any = async (t: string) => (t === 'tok' ? SESSION : null)) =>
  createStorefront({
    strapi: strapiWith({
      EcommercePickupPointService: { search },
      EcommerceStorefrontSessionService: { resolve },
    }),
  });

describe('storefront GET /shipping/pickup-points', () => {
  it('answers { points } and passes postalCode and country', async () => {
    const search = vi.fn().mockResolvedValue([POINT]);
    const ctx = sfCtx({ postalCode: '1000-001', country: 'PT', junk: 'x' });
    await storefront(search).pickupPoints(ctx);
    expect(search).toHaveBeenCalledWith({ postalCode: '1000-001', country: 'PT' });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ points: [POINT] });
  });

  it('country is optional (the service defaults to PT)', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const ctx = sfCtx({ postalCode: '1000001' });
    await storefront(search).pickupPoints(ctx);
    expect(search).toHaveBeenCalledWith({ postalCode: '1000001' });
    expect(ctx.body).toEqual({ points: [] });
  });

  it('needs a checkout session', async () => {
    const search = vi.fn();
    const ctx = sfCtx({ postalCode: '1000-001' }, '');
    await storefront(search).pickupPoints(ctx);
    expect(ctx.status).toBe(401);
    expect(ctx.body.error.details.code).toBe('SESSION_INVALID');
    expect(search).not.toHaveBeenCalled();
  });

  it('a non-string query value is a 400 without a search', async () => {
    const search = vi.fn();
    const ctx = sfCtx({ postalCode: ['1000-001', '2000-001'] });
    await storefront(search).pickupPoints(ctx);
    expect(ctx.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID_POSTAL_CODE', 'postalCode'],
    ['PICKUP_NOT_AVAILABLE', 'postalCode'],
  ])('%s → 400 with the code', async (code, path) => {
    const search = vi.fn().mockRejectedValue(new EcommerceValidationError(code, [{ path, code }]));
    const ctx = sfCtx({ postalCode: '1000-001' });
    await storefront(search).pickupPoints(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.details).toEqual({ code, errors: [{ path, code }] });
  });

  it('PICKUP_SEARCH_FAILED → 502', async () => {
    const search = vi.fn().mockRejectedValue(new EcommerceCarrierError('PICKUP_SEARCH_FAILED', 'x'));
    const ctx = sfCtx({ postalCode: '1000-001' });
    await storefront(search).pickupPoints(ctx);
    expect(ctx.status).toBe(502);
    expect(ctx.body.error.details).toEqual({ code: 'PICKUP_SEARCH_FAILED' });
  });
});

describe('admin GET /orders/pickup-points', () => {
  const adminCtx = (query: any): any => ({
    query,
    params: {},
    request: { body: {} },
    state: { user: { id: 1 } },
    badRequest: vi.fn(),
    notFound: vi.fn(),
  });
  const orders = (search: any) =>
    createOrders({ strapi: strapiWith({ EcommercePickupPointService: { search } }) });

  it('answers { points } for the postal code (always PT)', async () => {
    const search = vi.fn().mockResolvedValue([POINT]);
    const ctx = adminCtx({ postalCode: '1000-001', country: 'ES' });
    await orders(search).pickupPoints(ctx);
    expect(search).toHaveBeenCalledWith({ postalCode: '1000-001' });
    expect(ctx.body).toEqual({ points: [POINT] });
  });

  it('a validation error carries its code', async () => {
    const errors = [{ path: 'postalCode', code: 'PICKUP_NOT_AVAILABLE' }];
    const search = vi.fn().mockRejectedValue(new EcommerceValidationError('x', errors));
    const ctx = adminCtx({ postalCode: '1000-001' });
    await orders(search).pickupPoints(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'PICKUP_NOT_AVAILABLE', errors });
  });

  it('a search failure carries PICKUP_SEARCH_FAILED; a non-string postal code is passed as empty', async () => {
    const search = vi.fn().mockRejectedValue(new EcommerceCarrierError('PICKUP_SEARCH_FAILED', 'x'));
    const ctx = adminCtx({ postalCode: ['a'] });
    await orders(search).pickupPoints(ctx);
    expect(search).toHaveBeenCalledWith({ postalCode: '' });
    expect(ctx.badRequest).toHaveBeenCalledWith('x', { code: 'PICKUP_SEARCH_FAILED' });
  });
});
