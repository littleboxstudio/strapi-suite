import { describe, it, expect } from 'vitest';
import {
  promotionRemovalBlock,
  removePromotion,
  type PromotionRemovalContext,
} from '../../../../server/src/services/modules/ecommerce/domain/promotionRemoval';
import type { DiscountLine } from '../../../../server/src/services/modules/ecommerce/domain/discountRecalculation';
import {
  evaluatePromotions,
  PROMOTION_SEARCH_LIMIT_DEFAULT,
  type AppliedPromotion,
  type GiftOption,
  type PromotionCandidate,
  type Stacking,
} from '../../../../server/src/services/modules/ecommerce/domain/promotions';

const T = (...variantIds: number[]) => ({ productIds: [], variantIds });
const NOW = new Date('2026-11-13T12:00:00.000Z');
const ALL: Stacking = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };

const promo = (id: number, extra: Partial<PromotionCandidate>): PromotionCandidate => ({
  id,
  name: `P${id}`,
  code: null,
  method: 'AUTOMATIC',
  displayName: { en: `Promo ${id}` },
  priority: 0,
  eligibility: { mode: 'ALL' },
  conditions: { type: 'GROUP', operator: 'AND', children: [] },
  benefits: [],
  stacking: ALL,
  perOrderLimit: null,
  version: 1,
  active: true,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
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

const freeShipping = promo(1, {
  name: 'Free shipping over 50',
  conditions: {
    type: 'GROUP',
    operator: 'AND',
    children: [{ type: 'SUBTOTAL', operator: 'gte', value: 5000 }],
  },
  benefits: [{ type: 'SHIPPING_FREE', maxAmount: null }],
});
const buy2Gift = promo(3, {
  name: 'Buy 2 get a gift',
  benefits: [
    {
      type: 'BUY_X_GET_Y',
      buy: { target: T(1), quantity: 2, minAmount: null },
      get: { mode: 'GIFT', variantIds: [2], quantity: 1 },
      reward: { kind: 'FREE' },
    },
  ],
});
const tenOff = promo(4, {
  name: '10% on variant 2',
  benefits: [{ type: 'PRODUCT_PERCENT', target: T(2), percent: 10, maxQuantity: null }],
});
const orderFixed = promo(6, {
  name: '5 off the order',
  method: 'CODE',
  code: 'FIVE',
  benefits: [{ type: 'ORDER_FIXED', amount: 500 }],
});
const gift2: GiftOption = { variantId: 2, productId: 200, unitPrice: 3100, available: 10, active: true };

const checkout = (
  candidates: PromotionCandidate[],
  lines: { variantId: number; unitPrice: number; quantity: number }[],
  codes: string[] = []
): AppliedPromotion[] =>
  evaluatePromotions({
    lines: lines.map((l) => ({ ...l, productId: l.variantId * 100 })),
    email: null,
    shipping: 3000,
    codes,
    candidates,
    gifts: new Map([[2, gift2]]),
    now: NOW,
    searchLimit: PROMOTION_SEARCH_LIMIT_DEFAULT,
  }).applied;

// Order 25: created with 4× Black (variant 1) + variant 2; the Black lines were then removed.
const applied25 = checkout(
  [freeShipping, buy2Gift],
  [
    { variantId: 1, unitPrice: 2000, quantity: 4 },
    { variantId: 2, unitPrice: 3100, quantity: 1 },
  ]
);
const giftLine = (extra: Partial<DiscountLine> = {}) =>
  line(36, 2, 3100, 2, {
    isGift: true,
    unitDiscount: 3100,
    refs: [{ promotionId: 3, benefitIndex: 0, amount: 6200 }],
    ...extra,
  });
const order25 = (extra: Partial<PromotionRemovalContext> = {}): PromotionRemovalContext => ({
  lines: [line(35, 2, 3100, 1), giftLine()],
  applied: applied25,
  orderDiscount: 500,
  shippingGross: 3000,
  shippingDiscount: 3000,
  invoicedDiscountIds: [],
  shippingInvoiced: false,
  payments: [],
  refunds: [],
  ...extra,
});

describe('order 25 as stored', () => {
  it('has both promotions', () => {
    expect(applied25.map((a) => [a.promotionId, a.amount])).toEqual([
      [1, 3000],
      [3, 6200],
    ]);
  });
});

describe('removePromotion — gift promotion (order 25)', () => {
  const r = removePromotion(order25(), 3);

  it('removes its gift lines and keeps the paid line', () => {
    expect(r.removedGiftLines).toEqual([{ id: 36, variantId: 2, quantity: 2 }]);
    expect(r.giftUnits).toBe(2);
    expect(r.lines).toEqual([]);
  });

  it('drops the promotion and its 6200 of discount; nothing else changes', () => {
    expect(r.promotion.promotionId).toBe(3);
    expect(r.discount).toBe(6200);
    expect(r.applied.map((a) => a.promotionId)).toEqual([1]);
    expect(r.applied[0]).toEqual(applied25[0]);
    expect(r.orderDiscount).toBe(500);
    expect(r.shippingDiscount).toBe(3000);
    expect(r.before.productDiscount - r.after.productDiscount).toBe(6200);
    expect(r.before.itemsOriginal - r.after.itemsOriginal).toBe(6200);
  });

  it('a free gift is worth 0 to the total: the total stays', () => {
    expect(r.before.total).toBe(2600);
    expect(r.after.total).toBe(2600);
    expect(r.difference).toBe(0);
  });
});

describe('removePromotion — free shipping (order 25)', () => {
  const r = removePromotion(order25(), 1);

  it('charges the shipping again: the total rises by 3000', () => {
    expect(r.shippingDiscount).toBe(0);
    expect(r.after.shippingTotal).toBe(3000);
    expect(r.after.total).toBe(5600);
    expect(r.difference).toBe(3000);
    expect(r.after.due).toBe(5600);
  });

  it('keeps the gift promotion, its lines and the manual discount', () => {
    expect(r.applied.map((a) => a.promotionId)).toEqual([3]);
    expect(r.removedGiftLines).toEqual([]);
    expect(r.lines).toEqual([]);
    expect(r.orderDiscount).toBe(500);
    expect(r.giftUnits).toBe(0);
  });
});

describe('removePromotion — product discount', () => {
  const applied = checkout([tenOff], [{ variantId: 2, unitPrice: 3100, quantity: 2 }]);
  const ctx = (extra: Partial<PromotionRemovalContext> = {}): PromotionRemovalContext => ({
    lines: [
      line(10, 2, 3100, 2, {
        unitDiscount: 310,
        refs: [{ promotionId: 4, benefitIndex: 0, amount: 620 }],
      }),
      line(11, 5, 1000, 1),
    ],
    applied,
    orderDiscount: 0,
    shippingGross: 0,
    shippingDiscount: 0,
    invoicedDiscountIds: [],
    shippingInvoiced: false,
    payments: [{ status: 'COMPLETED', amount: 6200 } as any],
    refunds: [],
    ...extra,
  });

  it('puts the lines back at their price: the order owes the discount', () => {
    const r = removePromotion(ctx(), 4);
    expect(r.lines).toEqual([{ id: 10, unitDiscount: 0, refs: [] }]);
    expect(r.difference).toBe(620);
    expect(r.after.total).toBe(7200);
    expect(r.before.due).toBe(380);
    expect(r.after.due).toBe(1000);
  });

  it('splits a line shared with another promotion: only its units go back to full price', () => {
    const r = removePromotion(
      ctx({
        lines: [
          line(10, 2, 3100, 3, {
            unitDiscount: 310,
            refs: [
              { promotionId: 4, benefitIndex: 0, amount: 620 },
              { promotionId: 9, benefitIndex: 0, amount: 310 },
            ],
          }),
        ],
      }),
      4
    );
    expect(r.lines).toEqual([
      {
        id: 10,
        unitDiscount: 0,
        refs: [],
        splits: [
          { quantity: 2, unitDiscount: 0, refs: [] },
          { quantity: 1, unitDiscount: 310, refs: [{ promotionId: 9, benefitIndex: 0, amount: 310 }] },
        ],
      },
    ]);
    expect(r.difference).toBe(620);
  });
});

describe('removePromotion — order discount from a code', () => {
  it('takes its amount off the order discount, leaving the manual part', () => {
    const applied = checkout([orderFixed], [{ variantId: 2, unitPrice: 3100, quantity: 1 }], ['FIVE']);
    expect(applied[0].code).toBe('FIVE');
    const r = removePromotion(
      {
        lines: [line(35, 2, 3100, 1)],
        applied,
        orderDiscount: 700,
        shippingGross: 0,
        shippingDiscount: 0,
        invoicedDiscountIds: [],
        shippingInvoiced: false,
        payments: [],
        refunds: [],
      },
      6
    );
    expect(r.orderDiscount).toBe(200);
    expect(r.difference).toBe(500);
    expect(r.applied).toEqual([]);
  });
});

describe('promotionRemovalBlock', () => {
  it('allows order 25 (nothing invoiced or shipped)', () => {
    expect(promotionRemovalBlock(order25(), 3)).toBeNull();
    expect(promotionRemovalBlock(order25(), 1)).toBeNull();
  });

  it('refuses a promotion the order does not have', () => {
    expect(promotionRemovalBlock(order25(), 99)).toBe('PROMOTION_NOT_APPLIED');
    expect(() => removePromotion(order25(), 99)).toThrow('PROMOTION_NOT_APPLIED');
  });

  it('refuses a gift promotion whose gift units are invoiced', () => {
    const ctx = order25({ lines: [line(35, 2, 3100, 1), giftLine({ invoiced: 1 })] });
    expect(promotionRemovalBlock(ctx, 3)).toBe('PROMOTION_INVOICED');
    expect(() => removePromotion(ctx, 3)).toThrow('PROMOTION_INVOICED');
    // The other promotion is not affected.
    expect(promotionRemovalBlock(ctx, 1)).toBeNull();
  });

  it('refuses a gift promotion whose gift units are shipped or in a shipment', () => {
    expect(
      promotionRemovalBlock(order25({ lines: [line(35, 2, 3100, 1), giftLine({ shipped: 2 })] }), 3)
    ).toBe('PROMOTION_SHIPPED');
    expect(
      promotionRemovalBlock(order25({ lines: [line(35, 2, 3100, 1), giftLine({ reserved: 1 })] }), 3)
    ).toBe('PROMOTION_SHIPPED');
  });

  it('refuses a product discount whose discounted units are invoiced', () => {
    const ctx = order25({
      lines: [
        line(10, 2, 3100, 2, {
          unitDiscount: 310,
          invoiced: 2,
          refs: [{ promotionId: 3, benefitIndex: 0, amount: 620 }],
        }),
      ],
    });
    expect(promotionRemovalBlock(ctx, 3)).toBe('PROMOTION_INVOICED');
  });

  it('refuses a shipping discount once a shipping line or its discount is invoiced', () => {
    expect(promotionRemovalBlock(order25({ shippingInvoiced: true }), 1)).toBe('PROMOTION_INVOICED');
    expect(promotionRemovalBlock(order25({ invoicedDiscountIds: ['s:1'] }), 1)).toBe('PROMOTION_INVOICED');
    // The gift promotion does not discount the shipping.
    expect(promotionRemovalBlock(order25({ shippingInvoiced: true }), 3)).toBeNull();
  });

  it('refuses an order discount an invoice reflects', () => {
    expect(promotionRemovalBlock(order25({ invoicedDiscountIds: ['p:3:0'] }), 3)).toBe(
      'PROMOTION_INVOICED'
    );
  });
});
