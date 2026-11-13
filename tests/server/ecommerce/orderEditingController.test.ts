import { describe, expect, it, vi } from 'vitest';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import createController from '../../../server/src/controllers/modules/ecommerce/orderEditing';
import { CONFLICT_CODES } from '../../../server/src/controllers/modules/ecommerce/errors';

const controller = (service: Record<string, any>) =>
  createController({
    strapi: { plugin: () => ({ service: () => service }) } as any,
  });

const mkCtx = (extra: any = {}): any => ({
  params: {},
  query: {},
  request: { body: {} },
  state: { user: { id: 7 } },
  status: 200,
  badRequest: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});

const invalid = (code: string) =>
  new EcommerceValidationError('x', [{ path: 'p', code }]);

describe('EcommerceOrderEditingController', () => {
  it('passes the body without operationId, the actor and operationId to the service', async () => {
    const applyLines = vi.fn().mockResolvedValue({ ok: 1 });
    const ctx = mkCtx({
      params: { id: '3' },
      request: { body: { operationId: 'op-12345678', lines: [{ variantId: 1, quantity: 2 }] } },
    });
    await controller({ applyLines }).applyLines(ctx);
    expect(applyLines).toHaveBeenCalledWith(
      3,
      { lines: [{ variantId: 1, quantity: 2 }] },
      'user:7',
      'op-12345678'
    );
    expect(ctx.body).toEqual({ ok: 1 });
  });

  it('previews pass the whole body and no actor', async () => {
    const previewDiscounts = vi.fn().mockResolvedValue({});
    await controller({ previewDiscounts }).previewDiscounts(
      mkCtx({ params: { id: '2' }, request: { body: { selection: ['a'] } } })
    );
    expect(previewDiscounts).toHaveBeenCalledWith(2, { selection: ['a'] });
  });

  it('passes :lineId and :discountId as numbers', async () => {
    const editShippingLine = vi.fn().mockResolvedValue({});
    const removeManualDiscount = vi.fn().mockResolvedValue({});
    const c = controller({ editShippingLine, removeManualDiscount });
    await c.editShippingLine(
      mkCtx({ params: { id: '1', lineId: '5' }, request: { body: { operationId: 'o', amount: 3 } } })
    );
    expect(editShippingLine).toHaveBeenCalledWith(1, 5, { amount: 3 }, 'user:7', 'o');
    await c.removeManualDiscount(
      mkCtx({ params: { id: '1', discountId: '4' }, request: { body: { operationId: 'o' } } })
    );
    expect(removeManualDiscount).toHaveBeenCalledWith(1, 4, 'user:7', 'o');
  });

  it.each([
    ['id', { id: 'x', lineId: '1' }],
    ['lineId', { id: '1', lineId: 'x' }],
    ['lineId 0', { id: '1', lineId: '0' }],
  ])('rejects a bad %s with 400 without calling the service', async (_n, params) => {
    const editShippingLine = vi.fn();
    const ctx = mkCtx({ params });
    await controller({ editShippingLine }).editShippingLine(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid id');
    expect(editShippingLine).not.toHaveBeenCalled();
  });

  it('rejects a bad discountId with 400', async () => {
    const removeManualDiscount = vi.fn();
    const ctx = mkCtx({ params: { id: '1', discountId: '1.5' } });
    await controller({ removeManualDiscount }).removeManualDiscount(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid id');
    expect(removeManualDiscount).not.toHaveBeenCalled();
  });

  it('dismisses SHIPPING_REVIEW and DISCOUNTS_REVIEW only', async () => {
    const dismissReviewFlag = vi.fn().mockResolvedValue({});
    const c = controller({ dismissReviewFlag });
    await c.dismissReviewFlag(
      mkCtx({ params: { id: '1', code: 'DISCOUNTS_REVIEW' }, request: { body: { operationId: 'o' } } })
    );
    expect(dismissReviewFlag).toHaveBeenCalledWith(1, 'DISCOUNTS_REVIEW', 'user:7', 'o');
    const ctx = mkCtx({ params: { id: '1', code: 'OTHER' } });
    await c.dismissReviewFlag(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid order', {
      code: 'invalid',
      errors: [{ path: 'code', code: 'invalid' }],
    });
    expect(dismissReviewFlag).toHaveBeenCalledTimes(1);
  });

  it.each(['ORDER_NOT_EDITABLE', 'OPERATION_ID_CONFLICT', 'REVIEW_FLAG_NOT_DISMISSABLE'])(
    'maps %s to 409 with details.code',
    async (code) => {
      const ctx = mkCtx({ params: { id: '1' } });
      await controller({ recalculateShipping: vi.fn().mockRejectedValue(invalid(code)) })
        .recalculateShipping(ctx);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details.code).toBe(code);
    }
  );

  it('maps COUNTRY_NOT_SERVED to 400 with details.code', async () => {
    const ctx = mkCtx({ params: { id: '1' } });
    await controller({
      updateShippingAddress: vi.fn().mockRejectedValue(invalid('COUNTRY_NOT_SERVED')),
    }).updateShippingAddress(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid order', {
      code: 'COUNTRY_NOT_SERVED',
      errors: [{ path: 'p', code: 'COUNTRY_NOT_SERVED' }],
    });
  });

  it('lists the ruling 11 conflict codes', () => {
    expect(CONFLICT_CODES).toEqual(
      expect.arrayContaining([
        'OPERATION_ID_CONFLICT',
        'ORDER_NOT_EDITABLE',
        'ORDER_HAS_SHIPMENTS',
        'REVIEW_FLAG_NOT_DISMISSABLE',
        'PROMOTIONS_NOT_COMBINABLE',
        'PROMOTION_GIFT_SHIPPED',
      ])
    );
  });
});
