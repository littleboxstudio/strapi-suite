import { describe, it, expect } from 'vitest';
import {
  orderEditing,
  readReviewFlags,
  raiseFlag,
  clearFlag,
  type ReviewFlag,
} from '../../../../server/src/services/modules/ecommerce/domain/orderEditing';

const open = { orderStatus: 'OPEN' as const, hasPendingShipment: false, hasActiveShipment: false };

describe('orderEditing', () => {
  it('offers all 8 actions on an open order without shipments', () => {
    const r = orderEditing(open);
    expect(r).toEqual({
      editable: true,
      blockedBy: null,
      hasShipments: false,
      actions: [
        'ADD_PRODUCTS',
        'EDIT_ADDRESS',
        'RECALCULATE_SHIPPING',
        'EDIT_SHIPPING_LINE',
        'ADD_SHIPPING_LINE',
        'RECALCULATE_DISCOUNTS',
        'ADD_DISCOUNT',
        'REMOVE_DISCOUNT',
      ],
    });
  });

  it('hides address and shipping line edits once a shipment is active', () => {
    const r = orderEditing({ ...open, hasActiveShipment: true });
    expect(r.editable).toBe(true);
    expect(r.hasShipments).toBe(true);
    expect(r.actions).toEqual([
      'ADD_PRODUCTS',
      'RECALCULATE_SHIPPING',
      'ADD_SHIPPING_LINE',
      'RECALCULATE_DISCOUNTS',
      'ADD_DISCOUNT',
      'REMOVE_DISCOUNT',
    ]);
  });

  it('blocks everything while a shipment is pending', () => {
    expect(orderEditing({ ...open, hasPendingShipment: true })).toMatchObject({
      editable: false,
      blockedBy: 'SHIPMENT_PENDING',
      actions: [],
    });
  });

  it('blocks cancelled and archived orders', () => {
    expect(orderEditing({ ...open, orderStatus: 'CANCELLED' }).blockedBy).toBe('CANCELLED');
    expect(orderEditing({ ...open, orderStatus: 'ARCHIVED' })).toMatchObject({
      editable: false,
      blockedBy: 'ARCHIVED',
      actions: [],
    });
  });
});

describe('review flags', () => {
  const flag = (over: Partial<ReviewFlag> = {}): ReviewFlag => ({
    code: 'SHIPPING_REVIEW',
    reason: 'PRODUCTS_CHANGED',
    raisedAt: '2026-11-01T10:00:00.000Z',
    actor: 'admin',
    ...over,
  });

  it('reads null and unknown shapes as no flags', () => {
    expect(readReviewFlags(null)).toEqual([]);
    expect(readReviewFlags({ flags: [{ code: 'X' }] })).toEqual([]);
  });

  it('reads stored flags', () => {
    expect(readReviewFlags({ flags: [flag()] })).toEqual([flag()]);
  });

  it('replaces a raised flag of the same code', () => {
    const next = raiseFlag([flag()], flag({ reason: 'ADDRESS_CHANGED', raisedAt: '2026-11-02T10:00:00.000Z' }));
    expect(next).toEqual([flag({ reason: 'ADDRESS_CHANGED', raisedAt: '2026-11-02T10:00:00.000Z' })]);
  });

  it('keeps flags of other codes when raising', () => {
    const other = flag({ code: 'DISCOUNTS_REVIEW' });
    expect(raiseFlag([other], flag())).toHaveLength(2);
  });

  it('clears a raised flag and reports it', () => {
    expect(clearFlag([flag()], 'SHIPPING_REVIEW')).toEqual({ flags: [], cleared: true });
  });

  it('reports cleared false for an absent code', () => {
    const flags = [flag()];
    expect(clearFlag(flags, 'DISCOUNTS_REVIEW')).toEqual({ flags, cleared: false });
  });
});
