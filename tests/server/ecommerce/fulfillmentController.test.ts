import { describe, expect, it, vi } from 'vitest';
import {
  EcommerceCarrierError,
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createShipments from '../../../server/src/controllers/modules/ecommerce/shipments';
import createReturns from '../../../server/src/controllers/modules/ecommerce/returns';

const strapiWith = (services: Record<string, any>) =>
  ({ plugin: () => ({ service: (n: string) => services[n] }) }) as any;

const mkCtx = (extra: any = {}): any => {
  const headers: Record<string, string> = {};
  return {
    params: { id: '5' },
    query: {},
    request: { body: {} },
    state: { user: { id: 7 } },
    badRequest: vi.fn(),
    notFound: vi.fn(),
    set: (k: string, v: string) => (headers[k] = v),
    headers,
    ...extra,
  };
};
const body = (b: any, extra: any = {}) => mkCtx({ request: { body: b }, ...extra });

const validShipment = {
  lines: [{ orderLineId: 1, quantity: 2 }],
  method: { mode: 'MANUAL', carrierName: 'CTT', trackingCode: 'X1' },
  shippingCost: 0,
  idempotencyKey: 'k',
};

describe('EcommerceShipmentController', () => {
  it('create returns 201 and applies defaults (notifyCustomer true)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 9 });
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { create } }) });
    const ctx = body(validShipment);
    await c.create(ctx);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 9 });
    expect(create).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ notifyCustomer: true, shippingCost: 0, idempotencyKey: 'k' }),
      'user:7'
    );
  });

  it('create rejects invalid bodies with 400 and errors, never calling the service', async () => {
    const create = vi.fn();
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { create } }) });
    for (const bad of [
      { ...validShipment, lines: [] },
      { ...validShipment, lines: 'x' },
      { ...validShipment, lines: [{ orderLineId: 1, quantity: 1.5 }] },
      { ...validShipment, lines: [{ orderLineId: 0, quantity: 1 }] },
      { ...validShipment, method: { mode: 'OTHER' } },
      { ...validShipment, method: { mode: 'MANUAL' } },
      { ...validShipment, shippingCost: 1.5 },
      { ...validShipment, shippingCost: -1 },
      { ...validShipment, notifyCustomer: 'yes' },
      { ...validShipment, idempotencyKey: '' },
      { ...validShipment, idempotencyKey: 'x'.repeat(201) },
    ]) {
      const ctx = body(bad);
      await c.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errors: expect.any(Array) }));
    }
    const bad = mkCtx({ params: { id: 'abc' } });
    await c.create(bad);
    expect(bad.badRequest).toHaveBeenCalledWith('Invalid id');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['QUANTITY_EXCEEDS_PENDING', 'QUANTITY_EXCEEDS_RETURNABLE', 'ALREADY_DELIVERED', 'SHIPMENT_PENDING', 'SHIPMENT_UNCERTAIN', 'SHIPMENT_HAS_RETURNS', 'ORDER_CHANGED', 'SHIPMENT_STATE_CHANGED', 'IDEMPOTENCY_KEY_CONFLICT'])(
    'maps %s to 409',
    async (code) => {
      const create = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
      const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { create } }) });
      const ctx = body(validShipment);
      await c.create(ctx);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details.code).toBe(code);
    }
  );

  it.each([
    ['deliver', 'confirmDelivery', 'ALREADY_DELIVERED', { deliveredAt: '2026-01-01' }],
    ['cancel', 'cancel', 'SHIPMENT_HAS_RETURNS', { reason: 'x' }],
    ['retry', 'retry', 'SHIPMENT_STATE_CHANGED', {}],
    ['refreshTracking', 'refreshTracking', 'SHIPMENT_PENDING', {}],
    ['updateTracking', 'updateTracking', 'SHIPMENT_UNCERTAIN', {}],
  ])('%s maps %s conflicts (%s) to 409', async (handler, method, code, b) => {
    const fn = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
    const c: any = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { [method]: fn } }) });
    const ctx = body(b);
    await c[handler](ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe(code);
  });

  it.each(['unknown_line', 'duplicate_line', 'invalid_date', 'before_shipment', 'in_future', 'too_long', 'required'])(
    'domain field code %s is a 400 carrying the code and errors',
    async (code) => {
      const confirmDelivery = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
      const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { confirmDelivery } }) });
      const ctx = body({ deliveredAt: '2026-01-01' });
      await c.deliver(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code, errors: [{ path: 'p', code }] });
    }
  );

  it.each(['1e2', '0x10', ' 5', '5 ', '-1', '0', '1.5', '', '9'.repeat(30)])('rejects id %j strictly', async (id) => {
    const retry = vi.fn();
    const register = vi.fn();
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { retry } }) });
    const r = createReturns({ strapi: strapiWith({ EcommerceReturnService: { register } }) });
    const ctx = mkCtx({ params: { id } });
    await c.retry(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid id');
    const ctx2 = body({}, { params: { id } });
    await r.register(ctx2);
    expect(ctx2.badRequest).toHaveBeenCalledWith('Invalid id');
    expect(retry).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it.each(['ACTION_NOT_AVAILABLE', 'LABEL_NOT_AVAILABLE', 'NOT_SUPPORTED', 'invalid_url', 'INVALID_AMOUNT'])(
    'maps validation code %s to 400 with the code',
    async (code) => {
      const retry = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
      const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { retry } }) });
      const ctx = mkCtx();
      await c.retry(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
    }
  );

  it('maps the carrier NOT_SUPPORTED and other carrier errors to 400 with the code', async () => {
    const create = vi.fn().mockRejectedValue(new EcommerceCarrierError('NOT_SUPPORTED'));
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { create } }) });
    const ctx = body(validShipment);
    await c.create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'NOT_SUPPORTED' });
  });

  it('maps not found to 404 and rethrows unknown errors', async () => {
    const retry = vi.fn().mockRejectedValueOnce(new EcommerceNotFoundError('x')).mockRejectedValueOnce(new Error('boom'));
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { retry } }) });
    const ctx = mkCtx();
    await c.retry(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
    await expect(c.retry(mkCtx())).rejects.toThrow('boom');
  });

  it('deliver validates deliveredAt and notifyCustomer, defaulting notify to true', async () => {
    const confirmDelivery = vi.fn().mockResolvedValue({});
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { confirmDelivery } }) });
    for (const bad of [{}, { deliveredAt: 5 }, { deliveredAt: '2026-01-01', notifyCustomer: 'no' }]) {
      const ctx = body(bad);
      await c.deliver(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    }
    expect(confirmDelivery).not.toHaveBeenCalled();
    const ok = body({ deliveredAt: '2026-01-01' });
    await c.deliver(ok);
    expect(confirmDelivery).toHaveBeenCalledWith(5, { deliveredAt: '2026-01-01', notifyCustomer: true }, 'user:7');
    const off = body({ deliveredAt: '2026-01-01', notifyCustomer: false });
    await c.deliver(off);
    expect(confirmDelivery).toHaveBeenLastCalledWith(5, { deliveredAt: '2026-01-01', notifyCustomer: false }, 'user:7');
  });

  it('updateTracking passes undefined/null through and rejects non-strings and long values', async () => {
    const updateTracking = vi.fn().mockResolvedValue({});
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { updateTracking } }) });
    for (const bad of [{ trackingCode: 5 }, { trackingCode: 'x'.repeat(256) }, { trackingUrl: 'x'.repeat(2001) }]) {
      const ctx = body(bad);
      await c.updateTracking(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    }
    await c.updateTracking(body({ trackingCode: null, trackingUrl: 'https://t.example/1' }));
    expect(updateTracking).toHaveBeenCalledWith(5, { trackingCode: null, trackingUrl: 'https://t.example/1' }, 'user:7');
  });

  it('cancel and refresh pass the actor', async () => {
    const cancel = vi.fn().mockResolvedValue({});
    const refreshTracking = vi.fn().mockResolvedValue({});
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { cancel, refreshTracking } }) });
    await c.cancel(body({ reason: 'lost' }));
    expect(cancel).toHaveBeenCalledWith(5, { reason: 'lost' }, 'user:7');
    const bad = body({ reason: 'x'.repeat(501) });
    await c.cancel(bad);
    expect(bad.badRequest).toHaveBeenCalled();
    await c.refreshTracking(mkCtx());
    expect(refreshTracking).toHaveBeenCalledWith(5, 'user:7');
  });

  it('label sends the PDF with the right headers', async () => {
    const getLabel = vi.fn().mockResolvedValue({ filename: 'label 1.pdf', content: Buffer.from('%PDF') });
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { getLabel } }) });
    const ctx = mkCtx();
    await c.label(ctx);
    expect(ctx.type).toBe('application/pdf');
    expect(ctx.headers['Content-Disposition']).toBe('attachment; filename="label_1.pdf"');
    expect(ctx.headers['Cache-Control']).toBe('private, no-store');
    expect(Buffer.isBuffer(ctx.body)).toBe(true);
  });

  it.each([
    ['a\r\nSet-Cookie: x=1.pdf', 'a__Set-Cookie__x_1.pdf'],
    ['we"ird.pdf', 'we_ird.pdf'],
    ['../../etc/passwd', '_.._etc_passwd.pdf'],
    ['fatura é ção.pdf', 'fatura_____o.pdf'],
    ['', 'document.pdf'],
    ['.hidden', 'hidden.pdf'],
    ['noext', 'noext.pdf'],
    ['UPPER.PDF', 'UPPER.pdf'],
  ])('sanitises the label filename %j', async (name, expected) => {
    const getLabel = vi.fn().mockResolvedValue({ filename: name, content: Buffer.from('%PDF') });
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { getLabel } }) });
    const ctx = mkCtx();
    await c.label(ctx);
    const header = ctx.headers['Content-Disposition'];
    expect(header).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.pdf"$/);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toBe(`attachment; filename="${expected}"`);
  });

  it('label maps errors', async () => {
    const getLabel = vi.fn().mockRejectedValue(new EcommerceCarrierError('LABEL_UNAVAILABLE' as any));
    const c = createShipments({ strapi: strapiWith({ EcommerceShipmentService: { getLabel } }) });
    const ctx = mkCtx();
    await c.label(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'LABEL_UNAVAILABLE' });
    expect(ctx.body).toBeUndefined();
  });
});

describe('EcommerceReturnController', () => {
  const valid = { lines: [{ orderLineId: 1, quantity: 1, restock: true }], reason: 'Damaged', idempotencyKey: 'k' };

  it('register rejects a 201-character idempotencyKey', async () => {
    const register = vi.fn();
    const c = createReturns({ strapi: strapiWith({ EcommerceReturnService: { register } }) });
    const ctx = body({ ...valid, idempotencyKey: 'x'.repeat(201) });
    await c.register(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('register returns 201 with the service result', async () => {
    const register = vi.fn().mockResolvedValue({ return: { id: 1 }, refundable: 100 });
    const c = createReturns({ strapi: strapiWith({ EcommerceReturnService: { register } }) });
    const ctx = body(valid);
    await c.register(ctx);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ return: { id: 1 }, refundable: 100 });
    expect(register).toHaveBeenCalledWith(5, expect.objectContaining({ idempotencyKey: 'k' }), 'user:7');
  });

  it('register validates the body (restock boolean, notes <= 2000, reason <= 200)', async () => {
    const register = vi.fn();
    const c = createReturns({ strapi: strapiWith({ EcommerceReturnService: { register } }) });
    for (const bad of [
      { ...valid, lines: [{ orderLineId: 1, quantity: 1 }] },
      { ...valid, lines: [{ orderLineId: 1, quantity: 0, restock: true }] },
      { ...valid, notes: 'x'.repeat(2001) },
      { ...valid, reason: 'x'.repeat(201) },
      { ...valid, reason: '' },
      { ...valid, idempotencyKey: undefined },
    ]) {
      const ctx = body(bad);
      await c.register(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errors: expect.any(Array) }));
    }
    expect(register).not.toHaveBeenCalled();
  });

  it('register maps a returnable-quantity error to 409', async () => {
    const register = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'lines.0', code: 'QUANTITY_EXCEEDS_RETURNABLE' }]));
    const c = createReturns({ strapi: strapiWith({ EcommerceReturnService: { register } }) });
    const ctx = body(valid);
    await c.register(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('QUANTITY_EXCEEDS_RETURNABLE');
  });
});
