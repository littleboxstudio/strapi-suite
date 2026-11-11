import { describe, it, expect } from 'vitest';
import {
  applyCombination,
  type Benefit,
  type CombinationResult,
  type EvaluationLine,
  type GiftOption,
  type PromotionCandidate,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const T = (...variantIds: number[]) => ({ productIds: [], variantIds });
const A = T(1);
const B = T(2);

const promo = (
  id: number,
  benefits: Benefit[],
  extra: Partial<PromotionCandidate> = {}
): PromotionCandidate => ({
  id,
  name: `P${id}`,
  code: null,
  method: 'AUTOMATIC',
  displayName: {},
  priority: 0,
  eligibility: { mode: 'ALL' },
  conditions: { type: 'GROUP', operator: 'AND', children: [] },
  benefits,
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
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

const line = (variantId: number, unitPrice: number, quantity: number): EvaluationLine => ({
  variantId,
  productId: variantId * 100,
  unitPrice,
  quantity,
});

const run = (
  promotions: PromotionCandidate[],
  lines: EvaluationLine[],
  opts: {
    shipping?: number | null;
    gifts?: GiftOption[];
    giftChoices?: Record<number, number>;
  } = {}
): CombinationResult =>
  applyCombination(promotions, {
    lines,
    shipping: opts.shipping === undefined ? null : opts.shipping,
    gifts: new Map((opts.gifts ?? []).map((g) => [g.variantId, g])),
    giftChoices: opts.giftChoices ?? {},
  });

const shape = (r: CombinationResult) =>
  r.lines.map((l) => ({
    sourceIndex: l.sourceIndex,
    variantId: l.variantId,
    quantity: l.quantity,
    unitDiscount: l.unitDiscount,
    isGift: l.isGift,
  }));

/** Every result must be internally consistent, whatever the scenario. */
const checkInvariants = (r: CombinationResult, lines: EvaluationLine[]) => {
  for (const l of r.lines) {
    expect(Number.isInteger(l.unitDiscount)).toBe(true);
    expect(l.unitDiscount).toBeGreaterThanOrEqual(0);
    expect(l.unitDiscount).toBeLessThanOrEqual(l.unitPrice);
    expect(l.quantity).toBeGreaterThan(0);
    const refSum = l.refs.reduce((s, x) => s + x.amount, 0);
    expect(refSum).toBe(l.unitDiscount * l.quantity);
  }
  lines.forEach((src, i) => {
    const qty = r.lines.filter((l) => l.sourceIndex === i).reduce((s, l) => s + l.quantity, 0);
    expect(qty).toBe(src.quantity);
  });
  const items = r.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const product = r.lines.reduce((s, l) => s + l.unitDiscount * l.quantity, 0);
  expect(r.itemsOriginal).toBe(items);
  expect(r.productDiscount).toBe(product);
  expect(r.subtotal).toBe(items - product);
  expect(r.orderDiscount).toBeLessThanOrEqual(r.subtotal);
  expect(r.total).toBe(
    r.subtotal - r.orderDiscount + (r.shippingOriginal ?? 0) - r.shippingDiscount
  );
  expect(r.total).toBeGreaterThanOrEqual(0);
  let benefitSum = 0;
  for (const amounts of r.benefitAmounts.values()) benefitSum += amounts.reduce((s, a) => s + a, 0);
  expect(benefitSum).toBe(r.productDiscount + r.orderDiscount + r.shippingDiscount);
};

describe('applyCombination: product discounts', () => {
  it('1.17: fixed 5 € per unit on A at 30 € x 2', () => {
    const lines = [line(1, 3000, 2)];
    const r = run(
      [
        promo(1, [
          { type: 'PRODUCT_FIXED', target: A, amount: 500, per: 'UNIT', maxQuantity: null },
        ]),
      ],
      lines
    );
    expect(shape(r)).toEqual([
      { sourceIndex: 0, variantId: 1, quantity: 2, unitDiscount: 500, isGift: false },
    ]);
    expect(r.lines[0].refs).toEqual([{ promotionId: 1, benefitIndex: 0, amount: 1000 }]);
    expect(r.productDiscount).toBe(1000);
    expect(r.benefitAmounts.get(1)).toEqual([1000]);
    checkInvariants(r, lines);
  });

  it('1.18 / 3.3: 20% on A at 50 € x 2', () => {
    const lines = [line(1, 5000, 2)];
    const r = run(
      [promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 20, maxQuantity: null }])],
      lines
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].unitDiscount).toBe(1000);
    expect((r.lines[0].unitPrice - r.lines[0].unitDiscount) * r.lines[0].quantity).toBe(8000);
    expect(r.subtotal).toBe(8000);
    checkInvariants(r, lines);
  });

  it('2.7 same product: 20% and 30% on one unit of A -> only 30%', () => {
    const lines = [line(1, 10000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 20, maxQuantity: null }]),
        promo(2, [{ type: 'PRODUCT_PERCENT', target: A, percent: 30, maxQuantity: null }]),
      ],
      lines
    );
    expect(r.productDiscount).toBe(3000);
    expect(r.benefitAmounts.get(1)).toEqual([0]);
    expect(r.benefitAmounts.get(2)).toEqual([3000]);
    checkInvariants(r, lines);
  });

  it('2.7 different products both apply', () => {
    const lines = [line(1, 10000, 1), line(2, 5000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 10, maxQuantity: null }]),
        promo(2, [{ type: 'PRODUCT_PERCENT', target: B, percent: 20, maxQuantity: null }]),
      ],
      lines
    );
    expect(r.subtotal).toBe(13000);
    checkInvariants(r, lines);
  });

  it('maxQuantity caps units, most expensive first; the rest split into an undiscounted line', () => {
    const lines = [line(1, 1000, 3)];
    const r = run(
      [promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 10, maxQuantity: 2 }])],
      lines
    );
    expect(shape(r)).toEqual([
      { sourceIndex: 0, variantId: 1, quantity: 1, unitDiscount: 0, isGift: false },
      { sourceIndex: 0, variantId: 1, quantity: 2, unitDiscount: 100, isGift: false },
    ]);
    expect(r.lines[0].refs).toEqual([]);
    checkInvariants(r, lines);
  });

  it('with quota exhausted, the next-best benefit takes the remaining units', () => {
    const lines = [line(1, 1000, 3)];
    const r = run(
      [
        promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 50, maxQuantity: 1 }]),
        promo(2, [{ type: 'PRODUCT_PERCENT', target: A, percent: 10, maxQuantity: null }]),
      ],
      lines
    );
    expect(shape(r).map((l) => [l.quantity, l.unitDiscount])).toEqual([
      [2, 100],
      [1, 500],
    ]);
    expect(r.benefitAmounts.get(1)).toEqual([500]);
    expect(r.benefitAmounts.get(2)).toEqual([200]);
    checkInvariants(r, lines);
  });

  it('SET 5 € over 3 units of 10 € -> exactly 500 in integer groups', () => {
    const lines = [line(1, 1000, 3)];
    const r = run(
      [
        promo(1, [
          { type: 'PRODUCT_FIXED', target: A, amount: 500, per: 'SET', maxQuantity: null },
        ]),
      ],
      lines
    );
    expect(r.productDiscount).toBe(500);
    expect(shape(r).map((l) => [l.quantity, l.unitDiscount])).toEqual([
      [1, 166],
      [2, 167],
    ]);
    expect(r.benefitAmounts.get(1)).toEqual([500]);
    checkInvariants(r, lines);
  });

  it('SET near MAX_MONEY_CENTS splits exactly', () => {
    const AB = { productIds: [], variantIds: [1, 2] };
    const set = (amount: number): Benefit => ({
      type: 'PRODUCT_FIXED',
      target: AB,
      amount,
      per: 'SET',
      maxQuantity: null,
    });
    const tie = [line(1, 999998999, 1), line(2, 1, 1)];
    const r = run([promo(1, [set(499999500)])], tie);
    expect(r.lines.map((l) => l.unitDiscount)).toEqual([499999500, 0]);
    checkInvariants(r, tie);
    const big = [line(1, 1_000_000_000, 1), line(2, 7, 1)];
    const r2 = run([promo(1, [set(999999999)])], big);
    expect(r2.lines.map((l) => l.unitDiscount)).toEqual([999999992, 7]);
    checkInvariants(r2, big);
  });

  it('SET never exceeds the price of the units it wins', () => {
    const lines = [line(1, 100, 2)];
    const r = run(
      [
        promo(1, [
          { type: 'PRODUCT_FIXED', target: A, amount: 500, per: 'SET', maxQuantity: null },
        ]),
      ],
      lines
    );
    expect(r.productDiscount).toBe(200);
    expect(r.subtotal).toBe(0);
    checkInvariants(r, lines);
  });

  it('UNIT fixed never exceeds the unit price', () => {
    const lines = [line(1, 300, 2)];
    const r = run(
      [
        promo(1, [
          { type: 'PRODUCT_FIXED', target: A, amount: 500, per: 'UNIT', maxQuantity: null },
        ]),
      ],
      lines
    );
    expect(r.lines[0].unitDiscount).toBe(300);
    checkInvariants(r, lines);
  });

  it('ties go to the higher priority, then lower id', () => {
    const lines = [line(1, 1000, 1)];
    const b: Benefit = { type: 'PRODUCT_PERCENT', target: A, percent: 10, maxQuantity: null };
    const r = run([promo(1, [b]), promo(2, [b], { priority: 5 })], lines);
    expect(r.lines[0].refs[0].promotionId).toBe(2);
    const r2 = run([promo(3, [b]), promo(2, [b])], lines);
    expect(r2.lines[0].refs[0].promotionId).toBe(2);
  });
});

describe('applyCombination: Buy X Get Y', () => {
  const buy3pay2: Benefit = {
    type: 'BUY_X_GET_Y',
    buy: { target: A, quantity: 2, minAmount: null },
    get: { mode: 'IN_CART', target: A, quantity: 1 },
    reward: { kind: 'FREE' },
  };

  it('"buy 3, pay 2" splits the line exactly', () => {
    const lines = [line(1, 1000, 3)];
    const r = run([promo(1, [buy3pay2])], lines);
    expect(shape(r)).toEqual([
      { sourceIndex: 0, variantId: 1, quantity: 2, unitDiscount: 0, isGift: false },
      { sourceIndex: 0, variantId: 1, quantity: 1, unitDiscount: 1000, isGift: false },
    ]);
    expect(r.productDiscount).toBe(1000);
    expect(r.benefitAmounts.get(1)).toEqual([1000]);
    checkInvariants(r, lines);
  });

  it('repeats until units run out, and respects perOrderLimit', () => {
    const lines = [line(1, 1000, 7)];
    expect(run([promo(1, [buy3pay2])], lines).productDiscount).toBe(2000);
    expect(run([promo(1, [buy3pay2], { perOrderLimit: 1 })], lines).productDiscount).toBe(1000);
  });

  it('the cheapest units are the prize, the most expensive are bought', () => {
    const lines = [line(1, 1000, 2), line(1, 500, 1)];
    const r = run([promo(1, [buy3pay2])], lines);
    expect(r.productDiscount).toBe(500);
    expect(r.lines.find((l) => l.sourceIndex === 1)!.unitDiscount).toBe(500);
    checkInvariants(r, lines);
  });

  it('PERCENT and FIXED rewards', () => {
    const lines = [line(1, 1000, 3)];
    const pct = { ...buy3pay2, reward: { kind: 'PERCENT', percent: 50 } } as Benefit;
    const fix = { ...buy3pay2, reward: { kind: 'FIXED', amount: 5000 } } as Benefit;
    expect(run([promo(1, [pct])], lines).productDiscount).toBe(500);
    expect(run([promo(1, [fix])], lines).productDiscount).toBe(1000);
  });

  it('minAmount on the buy target', () => {
    const lines = [line(1, 1000, 3)];
    const b = { ...buy3pay2, buy: { target: A, quantity: 2, minAmount: 3001 } } as Benefit;
    expect(run([promo(1, [b])], lines).productDiscount).toBe(0);
    const ok = { ...buy3pay2, buy: { target: A, quantity: 2, minAmount: 3000 } } as Benefit;
    expect(run([promo(1, [ok])], lines).productDiscount).toBe(1000);
  });

  describe('2.11 / 2.12: 2 A at 10 € and 1 B at 15 €, "buy 2 A, get B"', () => {
    const lines = [line(1, 1000, 2), line(2, 1500, 1)];
    const getB = promo(1, [
      {
        type: 'BUY_X_GET_Y',
        buy: { target: A, quantity: 2, minAmount: null },
        get: { mode: 'IN_CART', target: B, quantity: 1 },
        reward: { kind: 'FREE' },
      },
    ]);

    it('B is free', () => {
      const r = run([getB], lines);
      expect(r.lines.find((l) => l.sourceIndex === 1)!.unitDiscount).toBe(1500);
      expect(r.productDiscount).toBe(1500);
      checkInvariants(r, lines);
    });

    it('10% on A still discounts both A units used as the purchase', () => {
      const r = run(
        [getB, promo(2, [{ type: 'PRODUCT_PERCENT', target: A, percent: 10, maxQuantity: null }])],
        lines
      );
      const a = r.lines.filter((l) => l.sourceIndex === 0);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ quantity: 2, unitDiscount: 100 });
      expect(r.productDiscount).toBe(1700);
      checkInvariants(r, lines);
    });

    it('10% on B does not discount the B received', () => {
      const r = run(
        [getB, promo(2, [{ type: 'PRODUCT_PERCENT', target: B, percent: 10, maxQuantity: null }])],
        lines
      );
      expect(r.productDiscount).toBe(1500);
      expect(r.benefitAmounts.get(2)).toEqual([0]);
      checkInvariants(r, lines);
    });

    it('a second "buy 2 A, get 1 A" does not reuse the same two A as purchase', () => {
      const r = run([getB, promo(2, [buy3pay2])], lines);
      expect(r.productDiscount).toBe(1500);
      expect(r.benefitAmounts.get(2)).toEqual([0]);
      checkInvariants(r, lines);
    });
  });

  describe('overlapping buy and get targets', () => {
    const AB = { productIds: [], variantIds: [1, 2] };
    const buyAnyGetB: Benefit = {
      type: 'BUY_X_GET_Y',
      buy: { target: AB, quantity: 1, minAmount: null },
      get: { mode: 'IN_CART', target: B, quantity: 1 },
      reward: { kind: 'FREE' },
    };

    it('"buy 1 of {A,B}, get 1 B": B 20 € and A 10 € -> B free, A bought', () => {
      const lines = [line(2, 2000, 1), line(1, 1000, 1)];
      const r = run([promo(1, [buyAnyGetB])], lines);
      expect(r.productDiscount).toBe(2000);
      expect(r.lines.find((l) => l.sourceIndex === 0)!.unitDiscount).toBe(2000);
      checkInvariants(r, lines);
    });

    it('repeats over overlapping targets: 2 B at 20 € and 2 A at 30 €', () => {
      const lines = [line(2, 2000, 2), line(1, 3000, 2)];
      const r = run([promo(1, [buyAnyGetB])], lines);
      expect(r.productDiscount).toBe(4000);
      expect(r.benefitAmounts.get(1)).toEqual([4000]);
      checkInvariants(r, lines);
    });
    it('buy units spare the prize target when they can: 2 B at 30 € and 2 A at 10 €', () => {
      const lines = [line(2, 3000, 2), line(1, 1000, 2)];
      const r = run([promo(1, [buyAnyGetB])], lines);
      expect(r.productDiscount).toBe(6000);
      expect(r.lines.find((l) => l.sourceIndex === 0)).toMatchObject({
        quantity: 2,
        unitDiscount: 3000,
      });
      checkInvariants(r, lines);
    });
  });

  it('"buy 1 A, get 1 of {A,B}": A 5 € and B 10 € -> A bought, B free', () => {
    const lines = [line(1, 500, 1), line(2, 1000, 1)];
    const b: Benefit = {
      type: 'BUY_X_GET_Y',
      buy: { target: A, quantity: 1, minAmount: null },
      get: { mode: 'IN_CART', target: { productIds: [], variantIds: [1, 2] }, quantity: 1 },
      reward: { kind: 'FREE' },
    };
    const r = run([promo(1, [b])], lines);
    expect(r.productDiscount).toBe(1000);
    checkInvariants(r, lines);
  });

  it('the same units cannot be the prize of two Buy X Get Y', () => {
    const lines = [line(1, 1000, 6)];
    const r = run([promo(1, [buy3pay2]), promo(2, [buy3pay2])], lines);
    expect(r.productDiscount).toBe(2000);
    expect(r.benefitAmounts.get(1)).toEqual([2000]);
    expect(r.benefitAmounts.get(2)).toEqual([0]);
    checkInvariants(r, lines);
  });

  describe('GIFT', () => {
    const gift = (variantIds = [20], quantity = 1): Benefit => ({
      type: 'BUY_X_GET_Y',
      buy: { target: A, quantity: 2, minAmount: null },
      get: { mode: 'GIFT', variantIds, quantity },
      reward: { kind: 'FREE' },
    });
    const g = (variantId: number, available: number, active = true): GiftOption => ({
      variantId,
      productId: variantId * 100,
      unitPrice: 800,
      available,
      active,
    });
    const lines = [line(1, 1000, 4)];

    it('1.22: perOrderLimit 1 -> 1 gift, 2 -> 2, null with available 1 -> 1', () => {
      const one = run([promo(1, [gift()], { perOrderLimit: 1 })], lines, { gifts: [g(20, 10)] });
      expect(shape(one).at(-1)).toEqual({
        sourceIndex: null,
        variantId: 20,
        quantity: 1,
        unitDiscount: 800,
        isGift: true,
      });
      checkInvariants(one, lines);
      const two = run([promo(1, [gift()], { perOrderLimit: 2 })], lines, { gifts: [g(20, 10)] });
      expect(two.lines.at(-1)!.quantity).toBe(2);
      expect(two.lines.filter((l) => l.isGift)).toHaveLength(1);
      const capped = run([promo(1, [gift()])], lines, { gifts: [g(20, 1)] });
      expect(capped.lines.at(-1)!.quantity).toBe(1);
      expect(capped.benefitAmounts.get(1)).toEqual([800]);
      checkInvariants(capped, lines);
    });

    it('gift line carries the gift price and the ref, and is counted in items', () => {
      const r = run([promo(1, [gift()], { perOrderLimit: 1 })], lines, { gifts: [g(20, 10)] });
      const gl = r.lines.at(-1)!;
      expect(gl).toMatchObject({ productId: 2000, unitPrice: 800 });
      expect(gl.refs).toEqual([{ promotionId: 1, benefitIndex: 0, amount: 800 }]);
      expect(r.itemsOriginal).toBe(4800);
      expect(r.subtotal).toBe(4000);
    });

    it('a valid choice is used; a choice without stock falls back to the first with stock', () => {
      const gifts = [g(20, 0), g(21, 5), g(22, 5)];
      const chosen = run([promo(1, [gift([20, 21, 22])], { perOrderLimit: 1 })], lines, {
        gifts,
        giftChoices: { 1: 22 },
      });
      expect(chosen.lines.at(-1)!.variantId).toBe(22);
      const fallback = run([promo(1, [gift([20, 21, 22])], { perOrderLimit: 1 })], lines, {
        gifts,
        giftChoices: { 1: 20 },
      });
      expect(fallback.lines.at(-1)!.variantId).toBe(21);
      const notListed = run([promo(1, [gift([20, 21])], { perOrderLimit: 1 })], lines, {
        gifts,
        giftChoices: { 1: 22 },
      });
      expect(notListed.lines.at(-1)!.variantId).toBe(21);
    });

    it('inactive gifts are skipped', () => {
      const r = run([promo(1, [gift([20, 21])], { perOrderLimit: 1 })], lines, {
        gifts: [g(20, 5, false), g(21, 5)],
        giftChoices: { 1: 20 },
      });
      expect(r.lines.at(-1)!.variantId).toBe(21);
    });

    it('no gift with stock -> no gift line and benefit 0', () => {
      const r = run([promo(1, [gift([20, 21])])], lines, { gifts: [g(20, 0), g(21, 0, true)] });
      expect(r.lines.some((l) => l.isGift)).toBe(false);
      expect(r.benefitAmounts.get(1)).toEqual([0]);
      checkInvariants(r, lines);
    });

    it('two promotions offering the same variant share its availability', () => {
      const r = run([promo(1, [gift()]), promo(2, [gift()])], lines, { gifts: [g(20, 1)] });
      expect(r.lines.filter((l) => l.isGift).reduce((s, l) => s + l.quantity, 0)).toBe(1);
      checkInvariants(r, lines);
    });
  });
});

describe('applyCombination: order and shipping', () => {
  it('2.9: 10% and 20% on a common base of 100 €', () => {
    const lines = [line(1, 10000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'ORDER_PERCENT', percent: 10 }]),
        promo(2, [{ type: 'ORDER_PERCENT', percent: 20 }]),
      ],
      lines
    );
    expect(r.orderDiscount).toBe(3000);
    expect(r.total).toBe(7000);
    checkInvariants(r, lines);
  });

  it('2.9: the sum never exceeds the subtotal (fixed 80 € + 50%)', () => {
    const lines = [line(1, 10000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'ORDER_FIXED', amount: 8000 }]),
        promo(2, [{ type: 'ORDER_PERCENT', percent: 50 }]),
      ],
      lines
    );
    expect(r.orderDiscount).toBe(10000);
    expect(r.total).toBe(0);
    expect(r.benefitAmounts.get(1)).toEqual([8000]);
    expect(r.benefitAmounts.get(2)).toEqual([2000]);
    checkInvariants(r, lines);
  });

  it('2.8 / 3.6: product, order and shipping together', () => {
    const lines = [line(1, 10000, 1), line(2, 5000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'PRODUCT_PERCENT', target: A, percent: 20, maxQuantity: null }]),
        promo(2, [{ type: 'ORDER_PERCENT', percent: 10 }]),
        promo(3, [{ type: 'SHIPPING_FREE', maxAmount: null }]),
      ],
      lines,
      { shipping: 800 }
    );
    expect(r.productDiscount).toBe(2000);
    expect(r.orderDiscount).toBe(1300);
    expect(r.shippingOriginal).toBe(800);
    expect(r.shippingDiscount).toBe(800);
    expect(r.total).toBe(11700);
    checkInvariants(r, lines);
  });

  it('2.10: only the largest shipping discount applies', () => {
    const lines = [line(1, 1000, 1)];
    const r = run(
      [
        promo(1, [{ type: 'SHIPPING_FIXED', amount: 500 }]),
        promo(2, [{ type: 'SHIPPING_FREE', maxAmount: null }]),
      ],
      lines,
      { shipping: 1200 }
    );
    expect(r.shippingDiscount).toBe(1200);
    expect(r.benefitAmounts.get(1)).toEqual([0]);
    expect(r.benefitAmounts.get(2)).toEqual([1200]);
    checkInvariants(r, lines);
  });

  it('1.19: free shipping capped by maxAmount', () => {
    const r = run([promo(1, [{ type: 'SHIPPING_FREE', maxAmount: 1000 }])], [line(1, 1000, 1)], {
      shipping: 1500,
    });
    expect(r.shippingDiscount).toBe(1000);
    expect(r.total).toBe(1500);
  });

  it('shipping percent and fixed are capped by the shipping cost', () => {
    const lines = [line(1, 1000, 1)];
    expect(
      run([promo(1, [{ type: 'SHIPPING_PERCENT', percent: 25 }])], lines, { shipping: 1000 })
        .shippingDiscount
    ).toBe(250);
    expect(
      run([promo(1, [{ type: 'SHIPPING_FIXED', amount: 5000 }])], lines, { shipping: 1000 })
        .shippingDiscount
    ).toBe(1000);
  });

  it('shipping null -> no shipping discount', () => {
    const lines = [line(1, 1000, 1)];
    const r = run([promo(1, [{ type: 'SHIPPING_FREE', maxAmount: null }])], lines, {
      shipping: null,
    });
    expect(r.shippingOriginal).toBeNull();
    expect(r.shippingDiscount).toBe(0);
    expect(r.benefitAmounts.get(1)).toEqual([0]);
    checkInvariants(r, lines);
  });

  it('benefitAmounts follow each promotion benefit index', () => {
    const lines = [line(1, 10000, 1)];
    const r = run(
      [
        promo(1, [
          { type: 'ORDER_PERCENT', percent: 10 },
          { type: 'SHIPPING_FIXED', amount: 100 },
          { type: 'PRODUCT_PERCENT', target: A, percent: 50, maxQuantity: null },
        ]),
      ],
      lines,
      { shipping: 500 }
    );
    expect(r.benefitAmounts.get(1)).toEqual([500, 100, 5000]);
    checkInvariants(r, lines);
  });

  it('no promotions: totals only', () => {
    const lines = [line(1, 1000, 2), line(2, 333, 1)];
    const r = run([], lines, { shipping: 400 });
    expect(r.itemsOriginal).toBe(2333);
    expect(r.total).toBe(2733);
    expect(shape(r).map((l) => l.quantity)).toEqual([2, 1]);
    checkInvariants(r, lines);
  });
});

describe('applyCombination: exact splits stress', () => {
  it('mixed SET, percent and BXGY over uneven prices keep every invariant', () => {
    const lines = [line(1, 999, 5), line(2, 1337, 3), line(1, 1, 2)];
    const AB = { productIds: [], variantIds: [1, 2] };
    const r = run(
      [
        promo(
          1,
          [{ type: 'PRODUCT_FIXED', target: AB, amount: 1001, per: 'SET', maxQuantity: 4 }],
          {
            priority: 2,
          }
        ),
        promo(2, [{ type: 'PRODUCT_PERCENT', target: AB, percent: 12.5, maxQuantity: null }]),
        promo(3, [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: B, quantity: 1, minAmount: null },
            get: { mode: 'IN_CART', target: A, quantity: 1 },
            reward: { kind: 'PERCENT', percent: 33 },
          },
          { type: 'ORDER_FIXED', amount: 777 },
        ]),
      ],
      lines,
      { shipping: 499 }
    );
    // Hand-checked: BXGY prizes are the cheapest A units (two 1-cent units at 0, then one 999 at
    // 330), bought with the three B. SET (1001 / E=4 = 250.25 per unit) beats 12.5% on the three B
    // and the first free A; the other three A take 12.5% (125). SET splits 1001 over
    // [999, 1337, 1337, 1337] as [200, 267, 267, 267].
    expect(shape(r).map((l) => [l.sourceIndex, l.quantity, l.unitDiscount])).toEqual([
      [0, 3, 125],
      [0, 1, 200],
      [0, 1, 330],
      [1, 3, 267],
      [2, 2, 0],
    ]);
    expect([...r.benefitAmounts]).toEqual([
      [1, [1001]],
      [2, [375]],
      [3, [330, 777]],
    ]);
    expect(r).toMatchObject({
      itemsOriginal: 9008,
      productDiscount: 1706,
      subtotal: 7302,
      orderDiscount: 777,
      shippingDiscount: 0,
      total: 7024,
    });
    checkInvariants(r, lines);
  });
});
