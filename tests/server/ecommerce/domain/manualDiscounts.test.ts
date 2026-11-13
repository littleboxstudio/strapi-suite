import { describe, it, expect } from 'vitest';
import {
  LEGACY_DISCOUNT_REASON,
  MAX_DISCOUNT_REASON,
  legacyManualDiscount,
  readManualDiscounts,
  manualDiscountTotal,
  buildManualDiscount,
  reconcileManualDiscounts,
  type ManualDiscount,
} from '../../../../server/src/services/modules/ecommerce/domain/manualDiscounts';

const CREATED = '2026-11-01T10:00:00.000Z';
const applied = (amount: number, cls = 'ORDER_DISCOUNT') => ({
  applied: [{ promotionId: 1, amount, benefits: [{ class: cls, amount }] }],
});
const CTX = { subtotal: 4000, orderDiscount: 0, nextId: 2, at: '2026-11-05T10:00:00.000Z', actor: 'admin:1' };

describe('legacyManualDiscount', () => {
  it('is the order discount minus the applied order-discount benefits', () => {
    expect(legacyManualDiscount({ createdAt: CREATED, orderDiscount: 1500, promotions: applied(1000) })).toEqual({
      id: 1,
      kind: 'LEGACY',
      percent: null,
      amount: 500,
      reason: LEGACY_DISCOUNT_REASON,
      createdAt: CREATED,
      actor: 'system',
    });
  });

  it('ignores benefits that are not order discounts', () => {
    expect(
      legacyManualDiscount({ createdAt: CREATED, orderDiscount: 300, promotions: applied(900, 'SHIPPING_DISCOUNT') })?.amount
    ).toBe(300);
  });

  it('is null when the promotions cover the whole discount', () => {
    expect(legacyManualDiscount({ createdAt: CREATED, orderDiscount: 800, promotions: applied(1000) })).toBeNull();
    expect(legacyManualDiscount({ createdAt: CREATED, orderDiscount: 0, promotions: [] })).toBeNull();
  });

  it('reads a legacy [] promotions column as no promotions', () => {
    expect(legacyManualDiscount({ createdAt: CREATED, orderDiscount: 300, promotions: [] })?.amount).toBe(300);
  });
});

describe('readManualDiscounts / manualDiscountTotal', () => {
  const stored: ManualDiscount = {
    id: 3, kind: 'FIXED', percent: null, amount: 200, reason: 'x', createdAt: CREATED, actor: 'admin:1',
  };

  it('returns the stored items', () => {
    const order = { createdAt: CREATED, orderDiscount: 200, promotions: [], manualDiscounts: { items: [stored] } };
    expect(readManualDiscounts(order)).toEqual([stored]);
  });

  it('reads an empty stored list as empty, not as the legacy item', () => {
    const order = { createdAt: CREATED, orderDiscount: 300, promotions: [], manualDiscounts: { items: [] } };
    expect(readManualDiscounts(order)).toEqual([]);
  });

  it('drops malformed entries', () => {
    const order = {
      createdAt: CREATED,
      orderDiscount: 200,
      promotions: [],
      manualDiscounts: { items: [stored, { ...stored, id: 5, amount: 'x' }, { ...stored, id: 6, kind: 'NOPE' }, null] },
    };
    expect(readManualDiscounts(order)).toEqual([stored]);
  });

  it('falls back to the legacy item, or [], when the column is null', () => {
    expect(readManualDiscounts({ createdAt: CREATED, orderDiscount: 300, promotions: [], manualDiscounts: null })).toHaveLength(1);
    expect(readManualDiscounts({ createdAt: CREATED, orderDiscount: 0, promotions: [] })).toEqual([]);
  });

  it('sums the amounts', () => {
    expect(manualDiscountTotal([stored, { ...stored, id: 4, amount: 50 }])).toBe(250);
    expect(manualDiscountTotal([])).toBe(0);
  });
});

describe('buildManualDiscount', () => {
  it('builds a FIXED discount with a trimmed reason', () => {
    const r = buildManualDiscount({ kind: 'FIXED', value: 500, reason: ' Goodwill ' }, CTX);
    expect(r.errors).toEqual([]);
    expect(r.discount).toEqual({
      id: 2, kind: 'FIXED', percent: null, amount: 500, reason: 'Goodwill', createdAt: CTX.at, actor: 'admin:1',
    });
  });

  it('builds a PERCENT discount from the subtotal', () => {
    const r = buildManualDiscount({ kind: 'PERCENT', value: 10, reason: 'VIP' }, { ...CTX, subtotal: 5000 });
    expect(r.discount).toMatchObject({ kind: 'PERCENT', percent: 10, amount: 500 });
  });

  it.each([12.345, 0, 101, -5, '10', null])('rejects the percent %s', (value) => {
    const r = buildManualDiscount({ kind: 'PERCENT', value, reason: 'x' }, CTX);
    expect(r.discount).toBeNull();
    expect(r.errors).toEqual([{ path: 'value', code: 'INVALID_AMOUNT' }]);
  });

  it.each([0, -1, 1.5, '5'])('rejects the fixed amount %s', (value) => {
    expect(buildManualDiscount({ kind: 'FIXED', value, reason: 'x' }, CTX).errors).toEqual([
      { path: 'value', code: 'INVALID_AMOUNT' },
    ]);
  });

  it('rejects an amount above what is left of the products', () => {
    const r = buildManualDiscount({ kind: 'FIXED', value: 3600, reason: 'x' }, { ...CTX, orderDiscount: 500 });
    expect(r.discount).toBeNull();
    expect(r.errors).toEqual([{ path: 'value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }]);
    expect(buildManualDiscount({ kind: 'FIXED', value: 3500, reason: 'x' }, { ...CTX, orderDiscount: 500 }).errors).toEqual([]);
  });

  it('requires a kind', () => {
    expect(buildManualDiscount({ kind: 'LEGACY', value: 5, reason: 'x' }, CTX).errors).toContainEqual({ path: 'kind', code: 'required' });
    expect(buildManualDiscount(null, CTX).errors).toContainEqual({ path: 'kind', code: 'required' });
  });

  it('requires a reason of 1..200 characters', () => {
    const bad = (reason: unknown) =>
      buildManualDiscount({ kind: 'FIXED', value: 5, reason }, CTX).errors;
    expect(bad('  ')).toEqual([{ path: 'reason', code: 'required' }]);
    expect(bad(undefined)).toEqual([{ path: 'reason', code: 'required' }]);
    expect(bad('a'.repeat(MAX_DISCOUNT_REASON + 1))).toEqual([{ path: 'reason', code: 'required' }]);
    expect(bad('a'.repeat(MAX_DISCOUNT_REASON))).toEqual([]);
  });
});

describe('reconcileManualDiscounts', () => {
  const item = (id: number, kind: 'FIXED' | 'PERCENT' | 'LEGACY', amount: number) => ({
    id,
    kind,
    percent: kind === 'PERCENT' ? 10 : null,
    amount,
    reason: 'r',
    createdAt: '',
    actor: 'user:1',
  });
  const promo = (amount: number) => ({
    applied: [
      {
        benefits: [
          { class: 'ORDER_DISCOUNT', amount },
          { class: 'PRODUCT_DISCOUNT', amount: 99 },
        ],
      },
    ],
  });

  it('within the order discount: unchanged', () => {
    const items = [item(1, 'FIXED', 300)];
    expect(reconcileManualDiscounts(items, { orderDiscount: 500, promotions: promo(200) })).toBe(
      items
    );
  });

  it('caps LEGACY first, then FIXED/PERCENT newest-first, never below 0; a LEGACY at 0 is dropped', () => {
    const items = [item(1, 'LEGACY', 1000), item(2, 'FIXED', 600), item(3, 'PERCENT', 400)];
    // Available to manual: 1500 − 200 = 1300; excess 700 → LEGACY 300.
    expect(
      reconcileManualDiscounts(items, { orderDiscount: 1500, promotions: promo(200) }).map(
        (m) => m.amount
      )
    ).toEqual([300, 600, 400]);
    // Available 600: excess 1400 → LEGACY dropped (1000), then id 3 400 → 0.
    expect(
      reconcileManualDiscounts(items, { orderDiscount: 800, promotions: promo(200) }).map((m) => [
        m.id,
        m.amount,
      ])
    ).toEqual([
      [2, 600],
      [3, 0],
    ]);
    // Nothing available: every amount 0, never negative.
    expect(
      reconcileManualDiscounts(items, { orderDiscount: 100, promotions: promo(200) }).map((m) => [
        m.id,
        m.amount,
      ])
    ).toEqual([
      [2, 0],
      [3, 0],
    ]);
  });
});
