import { describe, it, expect } from 'vitest';
import {
  recalculateDiscounts,
  type DiscountContext,
  type DiscountLine,
} from '../../../../server/src/services/modules/ecommerce/domain/discountRecalculation';
import type { ManualDiscount } from '../../../../server/src/services/modules/ecommerce/domain/manualDiscounts';
import {
  computeTotals,
  financialSummary,
} from '../../../../server/src/services/modules/ecommerce/domain/orders';
import {
  evaluatePromotions,
  PROMOTION_SEARCH_LIMIT_DEFAULT,
  type AppliedPromotion,
  type Benefit,
  type GiftOption,
  type PromotionCandidate,
  type Stacking,
} from '../../../../server/src/services/modules/ecommerce/domain/promotions';

const T = (...variantIds: number[]) => ({ productIds: [], variantIds });
const NOW = new Date('2026-11-13T12:00:00.000Z');
const ALL: Stacking = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };

const promo = (
  id: number,
  benefits: Benefit[],
  extra: Partial<PromotionCandidate> = {}
): PromotionCandidate => ({
  id,
  name: `P${id}`,
  code: null,
  method: 'AUTOMATIC',
  displayName: { en: `Promo ${id}` },
  priority: 0,
  eligibility: { mode: 'ALL' },
  conditions: { type: 'GROUP', operator: 'AND', children: [] },
  benefits,
  stacking: ALL,
  perOrderLimit: null,
  version: 1,
  active: true,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  requireVerifiedEmail: false,
  redemptions: 0,
  customerUses: 0,
  ...extra,
});

const line = (
  id: number,
  variantId: number,
  unitPrice: number,
  quantity: number,
  extra: Partial<DiscountLine> = {}
): DiscountLine => ({
  id,
  variantId,
  productId: variantId * 100,
  unitPrice,
  unitDiscount: 0,
  quantity,
  returnedQuantity: 0,
  isGift: false,
  shipped: 0,
  refs: [],
  ...extra,
});

/** What the checkout stored: the evaluation of these candidates on these lines. */
const checkout = (
  candidates: PromotionCandidate[],
  lines: DiscountLine[],
  opts: { shipping?: number; gifts?: GiftOption[] } = {}
): AppliedPromotion[] =>
  evaluatePromotions({
    lines: lines
      .filter((l) => !l.isGift)
      .map((l) => ({
        variantId: l.variantId,
        productId: l.productId,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
    email: null,
    shipping: opts.shipping ?? 0,
    codes: [],
    candidates,
    gifts: new Map((opts.gifts ?? []).map((g) => [g.variantId, g])),
    now: NOW,
    searchLimit: PROMOTION_SEARCH_LIMIT_DEFAULT,
  }).applied;

const ctx = (extra: Partial<DiscountContext>): DiscountContext => ({
  lines: [],
  applied: [],
  manual: [],
  orderDiscount: 0,
  shippingGross: 0,
  shippingDiscount: 0,
  email: null,
  codes: [],
  candidates: [],
  now: NOW,
  searchLimit: PROMOTION_SEARCH_LIMIT_DEFAULT,
  payments: [],
  refunds: [],
  ...extra,
});

const manual = (id: number, amount: number): ManualDiscount => ({
  id,
  kind: 'FIXED',
  percent: null,
  amount,
  reason: 'Loyal customer',
  createdAt: '2026-11-10T10:00:00.000Z',
  actor: 'admin:1',
});

describe('recalculateDiscounts — applied and still valid', () => {
  const p1 = promo(1, [{ type: 'ORDER_PERCENT', percent: 10 }]);
  const applied = checkout([p1], [line(1, 1, 2000, 2)]);
  const base = ctx({ lines: [line(1, 1, 2000, 3)], applied, orderDiscount: 400, candidates: [p1] });

  it('is kept selected and recalculated on the current lines', () => {
    expect(applied[0].amount).toBe(400);
    const r = recalculateDiscounts(base);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      key: 'p:1',
      kind: 'APPLIED_VALID',
      promotionId: 1,
      manualId: null,
      currentAmount: 400,
      amount: 600,
      invalidReason: null,
      selected: true,
      locked: null,
      method: 'AUTOMATIC',
      classes: ['ORDER_DISCOUNT'],
    });
    expect(r.selection).toEqual(['p:1']);
    expect(r.orderDiscount).toBe(600);
    expect(r.after.orderDiscount).toBe(600);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({ promotionId: 1, amount: 600 });
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.exhaustive).toBe(true);
  });

  it('computes before from the stored state and due/excess from financialSummary', () => {
    const payments = [{ status: 'COMPLETED' as const, amount: 5600 }];
    const r = recalculateDiscounts({ ...base, payments });
    const totals = computeTotals(base.lines, {
      orderDiscount: 400,
      shippingOriginal: 0,
      shippingDiscount: 0,
    });
    const before = financialSummary(totals.total, payments, []);
    expect(r.before).toEqual({
      ...totals,
      paid: before.paid,
      due: before.due,
      excess: before.excess,
    });
    expect(r.before.total).toBe(5600);
    expect(r.after).toMatchObject({ total: 5400, paid: 5600, due: 0, excess: 200 });
  });

  it('ignores unknown keys in the selection', () => {
    const r = recalculateDiscounts(base, ['x:9', 'p:99', 'p:1']);
    expect(r.selection).toEqual(['p:1']);
    expect(r.orderDiscount).toBe(600);
  });

  it('removes a deselected valid promotion and still reports the value it would give', () => {
    const r = recalculateDiscounts(base, []);
    expect(r.removed).toEqual([1]);
    expect(r.applied).toEqual([]);
    expect(r.orderDiscount).toBe(0);
    expect(r.rows[0]).toMatchObject({ selected: false, amount: 600 });
  });
});

describe('recalculateDiscounts — applied but no longer valid', () => {
  const p1 = promo(1, [{ type: 'PRODUCT_PERCENT', target: T(1), percent: 10, maxQuantity: null }]);
  const stored = [line(1, 1, 2000, 2), line(2, 2, 1000, 1)];
  const applied = checkout([p1], stored);
  const lines = [
    line(1, 1, 2000, 2, {
      unitDiscount: 200,
      refs: [{ promotionId: 1, benefitIndex: 0, amount: 400 }],
    }),
    line(2, 2, 1000, 1),
  ];
  const base = ctx({ lines, applied, candidates: [{ ...p1, active: false }] });

  it('is kept at its stored value with the real reason; its frozen line keeps its discount', () => {
    expect(applied[0].amount).toBe(400);
    const r = recalculateDiscounts(base);
    expect(r.rows[0]).toMatchObject({
      key: 'p:1',
      kind: 'APPLIED_INVALID',
      invalidReason: 'INACTIVE',
      selected: true,
      currentAmount: 400,
      amount: 400,
    });
    expect(r.lines).toEqual([]);
    expect(r.applied).toEqual(applied);
    expect(r.after.productDiscount).toBe(400);
    expect(r.after.total).toBe(4600);
    expect(r.removed).toEqual([]);
  });

  it('is NOT_FOUND when the promotion was deleted', () => {
    const r = recalculateDiscounts({ ...base, candidates: [] });
    expect(r.rows[0]).toMatchObject({
      kind: 'APPLIED_INVALID',
      invalidReason: 'NOT_FOUND',
      selected: true,
    });
  });

  it('goes away when deselected', () => {
    const r = recalculateDiscounts(base, []);
    expect(r.removed).toEqual([1]);
    expect(r.applied).toEqual([]);
    expect(r.lines).toEqual([{ id: 1, unitDiscount: 0, refs: [] }]);
    expect(r.after.productDiscount).toBe(0);
    expect(r.after.total).toBe(5000);
    expect(r.rows[0]).toMatchObject({ selected: false, amount: 400 });
  });

  it('keeps its stored ORDER and SHIPPING amounts', () => {
    const p2 = promo(2, [
      { type: 'ORDER_FIXED', amount: 300 },
      { type: 'SHIPPING_FIXED', amount: 200 },
    ]);
    const storedP2 = checkout([p2], [line(1, 1, 2000, 1)], { shipping: 700 });
    const r = recalculateDiscounts(
      ctx({
        lines: [line(1, 1, 2000, 1)],
        applied: storedP2,
        orderDiscount: 300,
        shippingGross: 700,
        shippingDiscount: 200,
        candidates: [{ ...p2, endsAt: '2026-02-01T00:00:00.000Z' }],
      })
    );
    expect(r.rows[0]).toMatchObject({
      kind: 'APPLIED_INVALID',
      invalidReason: 'EXPIRED',
      amount: 500,
    });
    expect(r.orderDiscount).toBe(300);
    expect(r.shippingDiscount).toBe(200);
  });
});

describe('recalculateDiscounts — frozen lines in order-level bases', () => {
  const p1 = promo(1, [{ type: 'PRODUCT_PERCENT', target: T(1), percent: 10, maxQuantity: null }]);
  const p2 = promo(2, [{ type: 'ORDER_PERCENT', percent: 10 }]);
  const stored = [line(1, 1, 2000, 2), line(2, 2, 1000, 1)];
  const lines = [
    line(1, 1, 2000, 2, {
      unitDiscount: 200,
      refs: [{ promotionId: 1, benefitIndex: 0, amount: 400 }],
    }),
    line(2, 2, 1000, 1),
  ];

  it("counts a frozen line's net value in a valid order promotion, without new line discounts", () => {
    const applied = checkout([p1, p2], stored);
    const r = recalculateDiscounts(
      ctx({ lines, applied, orderDiscount: 460, candidates: [{ ...p1, active: false }, p2] })
    );
    expect(r.rows.map((x) => [x.key, x.kind, x.amount])).toEqual([
      ['p:1', 'APPLIED_INVALID', 400],
      ['p:2', 'APPLIED_VALID', 460],
    ]);
    // 10 % of (2 × 1800 + 1000).
    expect(r.applied.find((a) => a.promotionId === 2)?.amount).toBe(460);
    expect(r.orderDiscount).toBe(460);
    expect(r.lines).toEqual([]);
    expect(r.after.total).toBe(4600 - 460);
  });

  it('gives a frozen line no new product discount', () => {
    const p3 = promo(3, [
      { type: 'PRODUCT_PERCENT', target: T(1, 2), percent: 50, maxQuantity: null },
    ]);
    const r = recalculateDiscounts(
      ctx({ lines, applied: checkout([p1], stored), candidates: [{ ...p1, active: false }, p3] }),
      ['p:1', 'p:3']
    );
    expect(r.lines).toEqual([
      { id: 2, unitDiscount: 500, refs: [{ promotionId: 3, benefitIndex: 0, amount: 500 }] },
    ]);
    expect(r.rows.find((x) => x.key === 'p:3')?.amount).toBe(500);
  });
});

describe('recalculateDiscounts — order discount clamp', () => {
  it('returns the order discount clamped to the new subtotal', () => {
    const p1 = promo(1, [{ type: 'ORDER_FIXED', amount: 1500 }]);
    const r = recalculateDiscounts(
      ctx({
        lines: [line(1, 1, 1000, 1)],
        applied: checkout([p1], [line(1, 1, 1000, 3)]),
        manual: [manual(1, 800)],
        orderDiscount: 2300,
        candidates: [{ ...p1, active: false }],
      })
    );
    expect(r.orderDiscount).toBe(1000);
    expect(r.after.orderDiscount).toBe(1000);
    expect(r.after.total).toBe(0);
  });
});

describe('recalculateDiscounts — new promotions', () => {
  const p2 = promo(2, [{ type: 'ORDER_FIXED', amount: 300 }]);
  const base = ctx({ lines: [line(1, 1, 2000, 2)], candidates: [p2] });

  it('is offered unselected with the value it would give', () => {
    const r = recalculateDiscounts(base);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      key: 'p:2',
      kind: 'NEW',
      selected: false,
      currentAmount: null,
      amount: 300,
      invalidReason: null,
    });
    expect(r.selection).toEqual([]);
    expect(r.orderDiscount).toBe(0);
    expect(r.applied).toEqual([]);
  });

  it('is added with a fresh applied entry when selected', () => {
    const r = recalculateDiscounts(base, ['p:2']);
    expect(r.added).toEqual([2]);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({
      promotionId: 2,
      version: 1,
      amount: 300,
      classes: ['ORDER_DISCOUNT'],
    });
    expect(r.applied[0].benefits).toEqual([
      {
        index: 0,
        type: 'ORDER_FIXED',
        class: 'ORDER_DISCOUNT',
        amount: 300,
        params: p2.benefits[0],
      },
    ]);
    expect(r.orderDiscount).toBe(300);
    expect(r.after.total).toBe(3700);
  });
});

describe('recalculateDiscounts — manual discounts', () => {
  const base = ctx({ lines: [line(1, 1, 2000, 2)], manual: [manual(1, 500)], orderDiscount: 500 });

  it('is a selected MANUAL row', () => {
    const r = recalculateDiscounts(base);
    expect(r.rows).toEqual([
      expect.objectContaining({
        key: 'm:1',
        kind: 'MANUAL',
        promotionId: null,
        manualId: 1,
        method: 'MANUAL',
        name: 'Loyal customer',
        currentAmount: 500,
        amount: 500,
        selected: true,
      }),
    ]);
    expect(r.manual).toEqual(base.manual);
    expect(r.orderDiscount).toBe(500);
  });

  it('is removed when deselected', () => {
    const r = recalculateDiscounts(base, []);
    expect(r.manual).toEqual([]);
    expect(r.orderDiscount).toBe(0);
    expect(r.after.total).toBe(r.before.total + 500);
  });
});

describe('recalculateDiscounts — stacking', () => {
  it('reports every pair of selected promotions that do not combine', () => {
    const p1 = promo(1, [{ type: 'ORDER_FIXED', amount: 100 }]);
    const p2 = promo(2, [{ type: 'ORDER_FIXED', amount: 200 }], {
      stacking: { ...ALL, exclusive: true },
    });
    const lines = [line(1, 1, 2000, 1)];
    const base = ctx({
      lines,
      applied: checkout([p1], lines),
      orderDiscount: 100,
      candidates: [p1, p2],
    });
    const initial = recalculateDiscounts(base);
    expect(initial.rows.map((r) => [r.key, r.kind, r.selected, r.amount])).toEqual([
      ['p:1', 'APPLIED_VALID', true, 100],
      ['p:2', 'NEW', false, 200],
    ]);
    expect(initial.conflicts).toEqual([]);
    expect(recalculateDiscounts(base, ['p:1', 'p:2']).conflicts).toEqual([['p:1', 'p:2']]);
  });

  it('checks kept-invalid promotions with their snapshot stacking', () => {
    const p1 = promo(1, [{ type: 'ORDER_FIXED', amount: 100 }], {
      stacking: { ...ALL, withOrder: false },
    });
    const p2 = promo(2, [{ type: 'ORDER_FIXED', amount: 200 }]);
    const lines = [line(1, 1, 2000, 1)];
    const r = recalculateDiscounts(
      ctx({
        lines,
        applied: checkout([p1], lines),
        orderDiscount: 100,
        candidates: [{ ...p1, active: false, stacking: ALL }, p2],
      }),
      ['p:1', 'p:2']
    );
    expect(r.rows[0]).toMatchObject({ kind: 'APPLIED_INVALID' });
    expect(r.conflicts).toEqual([['p:1', 'p:2']]);
  });
});

describe('recalculateDiscounts — rounding', () => {
  it('stores floor(D / q) per line and moves the remainder to the order discount', () => {
    // 100 over a set of 3 equal units: 34 + 33 + 33; line 1 (two units) gets 67.
    const p1 = promo(1, [
      { type: 'PRODUCT_FIXED', target: T(1, 2), amount: 100, per: 'SET', maxQuantity: 3 },
    ]);
    const lines = [line(1, 1, 1000, 2), line(2, 2, 1000, 1)];
    const r = recalculateDiscounts(
      ctx({
        lines,
        applied: checkout([p1], lines),
        manual: [manual(1, 200)],
        orderDiscount: 200,
        candidates: [p1],
      })
    );
    expect(r.lines).toEqual([
      { id: 1, unitDiscount: 33, refs: [{ promotionId: 1, benefitIndex: 0, amount: 67 }] },
      { id: 2, unitDiscount: 33, refs: [{ promotionId: 1, benefitIndex: 0, amount: 33 }] },
    ]);
    expect(r.orderDiscount).toBe(201);
    expect(r.rows[0].amount).toBe(100);
    // Combination total 2900, minus the kept manual 200, to the cent.
    expect(r.after.total).toBe(2700);
    expect(r.after.productDiscount + r.after.orderDiscount).toBe(300);
  });
});

describe('recalculateDiscounts — shipping promotions', () => {
  it('prices the shipping discount on the gross shipping', () => {
    const p3 = promo(3, [{ type: 'SHIPPING_FREE', maxAmount: null }]);
    const lines = [line(1, 1, 2000, 1)];
    const r = recalculateDiscounts(
      ctx({
        lines,
        applied: checkout([p3], lines, { shipping: 500 }),
        shippingGross: 700,
        shippingDiscount: 500,
        candidates: [p3],
      })
    );
    expect(r.rows[0]).toMatchObject({ kind: 'APPLIED_VALID', currentAmount: 500, amount: 700 });
    expect(r.shippingDiscount).toBe(700);
    expect(r.after.shippingTotal).toBe(0);
    expect(r.before.shippingTotal).toBe(200);
  });
});

describe('recalculateDiscounts — gift lines', () => {
  const p4 = promo(4, [
    {
      type: 'BUY_X_GET_Y',
      buy: { target: T(1), quantity: 1, minAmount: null },
      get: { mode: 'GIFT', variantIds: [9], quantity: 1 },
      reward: { kind: 'FREE' },
    },
  ]);
  const gift: GiftOption = {
    variantId: 9,
    productId: 900,
    unitPrice: 500,
    available: 10,
    active: true,
  };
  const applied = checkout([p4], [line(1, 1, 2000, 1)], { gifts: [gift] });
  const giftLine = (shipped: number) =>
    line(2, 9, 500, 1, {
      isGift: true,
      unitDiscount: 500,
      shipped,
      refs: [{ promotionId: 4, benefitIndex: 0, amount: 500 }],
    });
  const base = (shipped: number) =>
    ctx({ lines: [line(1, 1, 2000, 1), giftLine(shipped)], applied, candidates: [p4] });

  it('keeps the gift line and its value while the promotion stays selected', () => {
    expect(applied[0].amount).toBe(500);
    const r = recalculateDiscounts(base(0));
    expect(r.rows[0]).toMatchObject({
      kind: 'APPLIED_VALID',
      selected: true,
      locked: null,
      amount: 500,
    });
    expect(r.applied[0].amount).toBe(500);
    expect(r.removedGiftLines).toEqual([]);
    expect(r.lines).toEqual([]);
    expect(r.after.total).toBe(2000);
  });

  it('removes the unshipped gift line of a deselected promotion', () => {
    const r = recalculateDiscounts(base(0), []);
    expect(r.removed).toEqual([4]);
    expect(r.removedGiftLines).toEqual([{ id: 2, variantId: 9, quantity: 1 }]);
    expect(r.after).toMatchObject({ itemsOriginal: 2000, productDiscount: 0, total: 2000 });
  });

  it('locks a promotion whose gift was shipped: always selected', () => {
    const r = recalculateDiscounts(base(1), []);
    expect(r.rows[0]).toMatchObject({ locked: 'GIFT_SHIPPED', selected: true });
    expect(r.selection).toEqual(['p:4']);
    expect(r.removed).toEqual([]);
    expect(r.removedGiftLines).toEqual([]);
  });
});

describe('recalculateDiscounts — manual line discount (spec 4.1)', () => {
  const productPromo = promo(1, [{ type: 'PRODUCT_PERCENT', target: T(1, 2), percent: 50, maxQuantity: null }]);
  const orderPromo = promo(2, [{ type: 'ORDER_PERCENT', percent: 10 }]);
  // Line 1: 2 × 2000 with a manual 10 % (unit discount 200). Line 2: 1 × 1000 at full price.
  const lines = [
    line(1, 1, 2000, 2, { unitDiscount: 200, manualDiscountPercent: 10 }),
    line(2, 2, 1000, 1),
  ];

  it('a manual line takes no product promotion and keeps its unit discount', () => {
    const r = recalculateDiscounts(ctx({ lines, candidates: [productPromo] }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ kind: 'NEW', amount: 500 });
    const priced = recalculateDiscounts(ctx({ lines, candidates: [productPromo] }), ['p:1']);
    expect(priced.lines).toEqual([
      { id: 2, unitDiscount: 500, refs: [{ promotionId: 1, benefitIndex: 0, amount: 500 }] },
    ]);
    expect(priced.after.subtotal).toBe(2 * 1800 + 500);
  });

  it('a manual line counts at its net price in an order-level base', () => {
    const r = recalculateDiscounts(ctx({ lines, candidates: [orderPromo] }), ['p:2']);
    // 10 % of (2 × 1800 + 1000).
    expect(r.orderDiscount).toBe(460);
    expect(r.lines).toEqual([]);
  });
});
