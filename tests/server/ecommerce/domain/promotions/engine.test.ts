import { describe, it, expect } from 'vitest';
import {
  compatible,
  classesOf,
  evaluatePromotions,
  PROMOTION_SEARCH_LIMIT_DEFAULT,
  PROMOTION_SEARCH_LIMIT_MAX,
  type Benefit,
  type EvaluationInput,
  type EvaluationLine,
  type GiftOption,
  type PromotionCandidate,
  type PromotionEvaluation,
  type Stacking,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const T = (...variantIds: number[]) => ({ productIds: [], variantIds });
const NOW = new Date('2026-06-01T12:00:00.000Z');

const ALL: Stacking = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };
const EXCLUSIVE: Stacking = { ...ALL, exclusive: true };

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
  redemptions: 0,
  customerUses: 0,
  ...extra,
});

const coded = (
  id: number,
  code: string,
  benefits: Benefit[],
  extra: Partial<PromotionCandidate> = {}
): PromotionCandidate => promo(id, benefits, { method: 'CODE', code, ...extra });

const line = (variantId: number, unitPrice: number, quantity: number): EvaluationLine => ({
  variantId,
  productId: variantId * 100,
  unitPrice,
  quantity,
});

const evaluate = (
  candidates: PromotionCandidate[],
  lines: EvaluationLine[],
  opts: Partial<Omit<EvaluationInput, 'gifts'>> & { gifts?: GiftOption[] } = {}
): PromotionEvaluation =>
  evaluatePromotions({
    lines,
    email: opts.email ?? null,
    shipping: opts.shipping === undefined ? null : opts.shipping,
    codes: opts.codes ?? [],
    candidates,
    gifts: new Map((opts.gifts ?? []).map((g) => [g.variantId, g])),
    giftChoices: opts.giftChoices,
    now: opts.now ?? NOW,
    searchLimit: opts.searchLimit ?? PROMOTION_SEARCH_LIMIT_DEFAULT,
    onConditionError: opts.onConditionError,
  });

const appliedIds = (r: PromotionEvaluation) =>
  r.applied.map((a) => a.promotionId).sort((a, b) => a - b);
const reasonOf = (r: PromotionEvaluation, id: number) =>
  r.rejected.find((x) => x.promotionId === id)?.reason;

/** The money of every evaluation adds up. */
const checkMoney = (r: PromotionEvaluation) => {
  expect(r.subtotal).toBe(r.itemsOriginal - r.productDiscount);
  expect(r.totalDiscount).toBe(r.productDiscount + r.orderDiscount + r.shippingDiscount);
  expect(r.total).toBe(
    r.subtotal - r.orderDiscount + (r.shippingOriginal ?? 0) - r.shippingDiscount
  );
  expect(r.applied.reduce((s, a) => s + a.amount, 0)).toBe(r.totalDiscount);
  for (const a of r.applied) {
    expect(a.amount).toBeGreaterThan(0);
    expect(a.amount).toBe(a.benefits.reduce((s, b) => s + b.amount, 0));
  }
  expect(new Set(r.applied.map((a) => a.promotionId)).size).toBe(r.applied.length);
};

describe('constants', () => {
  it('search limit default 12, max 16', () => {
    expect(PROMOTION_SEARCH_LIMIT_DEFAULT).toBe(12);
    expect(PROMOTION_SEARCH_LIMIT_MAX).toBe(16);
  });
});

describe('classesOf / compatible', () => {
  it('collects the classes of the benefits', () => {
    const p = promo(1, [
      { type: 'ORDER_PERCENT', percent: 10 },
      { type: 'SHIPPING_FREE', maxAmount: null },
    ]);
    expect([...classesOf(p)].sort()).toEqual(['ORDER_DISCOUNT', 'SHIPPING_DISCOUNT']);
  });

  it('2.3: order 10% (stacks with product) vs product 500 (does not stack with order) -> incompatible', () => {
    const a = promo(1, [{ type: 'ORDER_PERCENT', percent: 10 }], {
      stacking: { exclusive: false, withProduct: true, withOrder: false, withShipping: false },
    });
    const b = promo(
      2,
      [{ type: 'PRODUCT_FIXED', target: T(1), amount: 500, per: 'UNIT', maxQuantity: null }],
      { stacking: { exclusive: false, withProduct: true, withOrder: false, withShipping: true } }
    );
    expect(compatible(a, b)).toBe(false);
    expect(compatible(b, a)).toBe(false);
    const r = evaluate([a, b], [line(1, 10000, 1)]);
    expect(r.applied).toHaveLength(1);
    expect(appliedIds(r)).toEqual([1]);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
    checkMoney(r);
  });

  it('2.5: NATAL2026 (order + shipping) vs a promotion that only stacks with order -> incompatible', () => {
    const natal = coded(
      1,
      'NATAL2026',
      [
        { type: 'ORDER_PERCENT', percent: 10 },
        { type: 'SHIPPING_FREE', maxAmount: null },
      ],
      { stacking: ALL }
    );
    const other = promo(2, [{ type: 'ORDER_FIXED', amount: 300 }], {
      stacking: { exclusive: false, withProduct: false, withOrder: true, withShipping: false },
    });
    expect(compatible(natal, other)).toBe(false);
    expect(compatible(other, natal)).toBe(false);
  });

  it('exclusive is never compatible; fully stackable pairs are', () => {
    const a = promo(1, [{ type: 'ORDER_FIXED', amount: 1 }]);
    const b = promo(2, [{ type: 'SHIPPING_FREE', maxAmount: null }]);
    expect(compatible(a, b)).toBe(true);
    expect(compatible({ ...a, stacking: EXCLUSIVE }, b)).toBe(false);
    expect(compatible(a, { ...b, stacking: EXCLUSIVE })).toBe(false);
  });
});

describe('best combination', () => {
  const pctProducts = (id: number, extra: Partial<PromotionCandidate> = {}) =>
    promo(id, [{ type: 'PRODUCT_PERCENT', target: T(1), percent: 10, maxQuantity: null }], extra);
  const orderFixed = (id: number, extra: Partial<PromotionCandidate> = {}) =>
    promo(id, [{ type: 'ORDER_FIXED', amount: 2000 }], extra);
  const freeShipping = (id: number, extra: Partial<PromotionCandidate> = {}) =>
    promo(id, [{ type: 'SHIPPING_FREE', maxAmount: null }], extra);

  it('2.13: all exclusive -> B (total 14000)', () => {
    const r = evaluate(
      [
        pctProducts(1, { stacking: EXCLUSIVE }),
        orderFixed(2, { stacking: EXCLUSIVE }),
        freeShipping(3, { stacking: EXCLUSIVE }),
      ],
      [line(1, 15000, 1)],
      { shipping: 1000 }
    );
    expect(appliedIds(r)).toEqual([2]);
    expect(r.total).toBe(14000);
    expect(r.exhaustive).toBe(true);
    expect(reasonOf(r, 1)).toBe('CONFLICT');
    expect(reasonOf(r, 3)).toBe('CONFLICT');
    checkMoney(r);
  });

  it('2.13: A and C stack with each other -> A + C (total 13500)', () => {
    const r = evaluate(
      [pctProducts(1), orderFixed(2, { stacking: EXCLUSIVE }), freeShipping(3)],
      [line(1, 15000, 1)],
      { shipping: 1000 }
    );
    expect(appliedIds(r)).toEqual([1, 3]);
    expect(r.total).toBe(13500);
    expect(r.productDiscount).toBe(1500);
    expect(r.shippingDiscount).toBe(1000);
    expect(r.totalDiscount).toBe(2500);
    checkMoney(r);
  });

  it('2.4: exclusive 30% beats free shipping (total 7800)', () => {
    const r = evaluate(
      [
        promo(1, [{ type: 'ORDER_PERCENT', percent: 30 }], { stacking: EXCLUSIVE }),
        freeShipping(2),
      ],
      [line(1, 10000, 1)],
      { shipping: 800 }
    );
    expect(appliedIds(r)).toEqual([1]);
    expect(r.total).toBe(7800);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
    checkMoney(r);
  });

  it('2.7: 10% on A and 20% on B, stackable -> both, subtotal 13000', () => {
    const r = evaluate(
      [
        promo(1, [{ type: 'PRODUCT_PERCENT', target: T(1), percent: 10, maxQuantity: null }]),
        promo(2, [{ type: 'PRODUCT_PERCENT', target: T(2), percent: 20, maxQuantity: null }]),
      ],
      [line(1, 10000, 1), line(2, 5000, 1)]
    );
    expect(appliedIds(r)).toEqual([1, 2]);
    expect(r.subtotal).toBe(13000);
    checkMoney(r);
  });

  const bxgy = (id: number, getVariant: number): PromotionCandidate =>
    promo(id, [
      {
        type: 'BUY_X_GET_Y',
        buy: { target: T(1), quantity: 2, minAmount: null },
        get: { mode: 'IN_CART', target: T(getVariant), quantity: 1 },
        reward: { kind: 'FREE' },
      },
    ]);

  it('2.12: buy 2 X get Y and buy 2 X get Z with 4 X -> both (1400)', () => {
    const r = evaluate(
      [bxgy(1, 2), bxgy(2, 3)],
      [line(1, 1000, 4), line(2, 800, 1), line(3, 600, 1)]
    );
    expect(appliedIds(r)).toEqual([1, 2]);
    expect(r.productDiscount).toBe(1400);
    checkMoney(r);
  });

  it('2.12: only 2 X -> only the Y one', () => {
    const r = evaluate(
      [bxgy(1, 2), bxgy(2, 3)],
      [line(1, 1000, 2), line(2, 800, 1), line(3, 600, 1)]
    );
    expect(appliedIds(r)).toEqual([1]);
    expect(r.productDiscount).toBe(800);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
    checkMoney(r);
  });

  it('2.15: automatic 10% + compatible free-shipping code -> both, code APPLIED', () => {
    const r = evaluate(
      [
        promo(1, [{ type: 'ORDER_PERCENT', percent: 10 }]),
        coded(2, 'FRETE', [{ type: 'SHIPPING_FREE', maxAmount: null }]),
      ],
      [line(1, 10000, 1)],
      { shipping: 500, codes: ['frete'] }
    );
    expect(appliedIds(r)).toEqual([1, 2]);
    expect(r.codes).toEqual([{ code: 'FRETE', status: 'APPLIED', promotionId: 2 }]);
    expect(r.applied.find((a) => a.promotionId === 2)?.code).toBe('FRETE');
    expect(r.applied.find((a) => a.promotionId === 2)?.method).toBe('CODE');
    checkMoney(r);
  });

  it('2.15: incompatible and the code loses -> CONFLICT, never NOT_FOUND', () => {
    const r = evaluate(
      [
        promo(1, [{ type: 'ORDER_PERCENT', percent: 10 }], { stacking: EXCLUSIVE }),
        coded(2, 'FRETE', [{ type: 'SHIPPING_FREE', maxAmount: null }]),
      ],
      [line(1, 10000, 1)],
      { shipping: 500, codes: ['FRETE'] }
    );
    expect(appliedIds(r)).toEqual([1]);
    expect(r.codes).toEqual([{ code: 'FRETE', status: 'CONFLICT', promotionId: 2 }]);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
  });
  it('a member that realises 0 in the chosen combination leaves it as CONFLICT', () => {
    // Both are compatible; only the larger shipping discount is applied, so the code adds 0.
    const r = evaluate(
      [
        promo(1, [{ type: 'SHIPPING_FREE', maxAmount: null }]),
        coded(2, 'SHIP1', [{ type: 'SHIPPING_FIXED', amount: 100 }]),
      ],
      [line(1, 10000, 1)],
      { shipping: 500, codes: ['SHIP1'] }
    );
    expect(appliedIds(r)).toEqual([1]);
    expect(r.codes[0]).toEqual({ code: 'SHIP1', status: 'CONFLICT', promotionId: 2 });
    expect(r.total).toBe(10000);
    checkMoney(r);
  });
});

describe('tie-breaks', () => {
  const fixed = (id: number, extra: Partial<PromotionCandidate> = {}) =>
    promo(id, [{ type: 'ORDER_FIXED', amount: 500 }], { stacking: EXCLUSIVE, ...extra });

  it('same total: the entered code wins', () => {
    const r = evaluate(
      [fixed(1, { priority: 9 }), fixed(2, { method: 'CODE', code: 'X5' })],
      [line(1, 10000, 1)],
      {
        codes: ['X5'],
      }
    );
    expect(appliedIds(r)).toEqual([2]);
    expect(r.codes[0].status).toBe('APPLIED');
    expect(reasonOf(r, 1)).toBe('CONFLICT');
  });

  it('same total, no code: higher priority wins', () => {
    const r = evaluate([fixed(1, { priority: 1 }), fixed(2, { priority: 5 })], [line(1, 10000, 1)]);
    expect(appliedIds(r)).toEqual([2]);
  });

  it('everything equal: the lowest id wins', () => {
    const r = evaluate([fixed(7), fixed(3)], [line(1, 10000, 1)]);
    expect(appliedIds(r)).toEqual([3]);
  });

  it('same total: fewer promotions win over more (equal priority sum)', () => {
    // 1 + 2 together give 500, 3 alone gives 500.
    const r = evaluate(
      [
        promo(1, [{ type: 'ORDER_FIXED', amount: 200 }]),
        promo(2, [{ type: 'ORDER_FIXED', amount: 300 }]),
        promo(3, [{ type: 'ORDER_FIXED', amount: 500 }], { stacking: EXCLUSIVE }),
      ],
      [line(1, 10000, 1)]
    );
    expect(appliedIds(r)).toEqual([3]);
  });

  it('a code member realising 0 does not win the entered-code tie-break', () => {
    // A and B are both free shipping (only one shipping discount applies); the code adds 0
    // next to either, so {A, code} must not beat {B} (higher priority) on entered codes.
    const r = evaluate(
      [
        promo(1, [{ type: 'SHIPPING_FREE', maxAmount: null }]),
        // B does not stack with the code, so only {A, code} contains it.
        promo(2, [{ type: 'SHIPPING_FREE', maxAmount: null }], {
          priority: 5,
          stacking: { ...ALL, withShipping: false },
        }),
        coded(3, 'SHIP1', [{ type: 'SHIPPING_FIXED', amount: 100 }]),
      ],
      [line(1, 10000, 1)],
      { shipping: 500, codes: ['SHIP1'] }
    );
    expect(appliedIds(r)).toEqual([2]);
    expect(reasonOf(r, 1)).toBe('CONFLICT');
    expect(r.codes[0]).toEqual({ code: 'SHIP1', status: 'CONFLICT', promotionId: 3 });
    checkMoney(r);
  });

  it('shuffled candidates give the same result', () => {
    const cands = [
      fixed(1, { priority: 1 }),
      fixed(2, { priority: 1 }),
      promo(3, [{ type: 'SHIPPING_FREE', maxAmount: null }]),
      promo(4, [{ type: 'PRODUCT_PERCENT', target: T(1), percent: 5, maxQuantity: null }]),
      coded(5, 'ABC', [{ type: 'ORDER_PERCENT', percent: 5 }], { stacking: EXCLUSIVE }),
      promo(6, [{ type: 'ORDER_FIXED', amount: 100 }]),
    ];
    const opts = { shipping: 400, codes: ['abc', 'nope'] };
    const base = evaluate(cands, [line(1, 10000, 1)], opts);
    const orders = [
      [5, 3, 1, 0, 4, 2],
      [2, 0, 4, 1, 5, 3],
      [3, 4, 5, 0, 1, 2],
    ];
    for (const o of orders) {
      const r = evaluate(
        o.map((i) => cands[i]),
        [line(1, 10000, 1)],
        opts
      );
      expect(r).toEqual(base);
    }
  });
});

describe('search limit', () => {
  it('a search limit above the maximum is clamped to 16', () => {
    const cands = Array.from({ length: 17 }, (_, i) =>
      promo(i + 1, [{ type: 'ORDER_FIXED', amount: 10 }])
    );
    expect(evaluate(cands, [line(1, 100000, 1)], { searchLimit: 40 }).exhaustive).toBe(false);
  });

  // 13 positive candidates: odd ids exclusive, even ids stack with everything.
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      promo(i + 1, [{ type: 'ORDER_FIXED', amount: 100 + i * 10 }], {
        stacking: (i + 1) % 2 === 1 ? EXCLUSIVE : ALL,
      })
    );

  const assertCompatible = (r: PromotionEvaluation, cands: PromotionCandidate[]) => {
    const chosen = cands.filter((c) => r.applied.some((a) => a.promotionId === c.id));
    for (const a of chosen)
      for (const b of chosen) if (a !== b) expect(compatible(a, b)).toBe(true);
    expect(chosen.length).toBeGreaterThan(0);
  };

  const two = () => [
    promo(1, [{ type: 'ORDER_FIXED', amount: 100 }]),
    promo(2, [{ type: 'ORDER_FIXED', amount: 200 }]),
  ];

  it('searchLimit 0 -> greedy; NaN and 1.5 -> the default 12', () => {
    expect(evaluate(two(), [line(1, 10000, 1)], { searchLimit: 0 }).exhaustive).toBe(false);
    expect(evaluate(two(), [line(1, 10000, 1)], { searchLimit: NaN }).exhaustive).toBe(true);
    expect(evaluate(two(), [line(1, 10000, 1)], { searchLimit: 1.5 }).exhaustive).toBe(true);
    for (const searchLimit of [0, NaN, 1.5]) {
      const r = evaluate(two(), [line(1, 10000, 1)], { searchLimit });
      expect(appliedIds(r)).toEqual([1, 2]);
      expect(r.total).toBe(9700);
    }
  });

  it('greedy never adds a promotion that raises the cost', () => {
    // P2 (priority 10) is processed first and takes a unit with 10%, blocking P1's 50% there.
    const p1 = promo(1, [
      { type: 'PRODUCT_PERCENT', target: T(1), percent: 50, maxQuantity: null },
    ]);
    const p2 = promo(
      2,
      [
        {
          type: 'BUY_X_GET_Y',
          buy: { target: T(1), quantity: 1, minAmount: null },
          get: { mode: 'IN_CART', target: T(1), quantity: 1 },
          reward: { kind: 'PERCENT', percent: 10 },
        },
      ],
      { priority: 10 }
    );
    const r = evaluate([p1, p2], [line(1, 1000, 2)], { searchLimit: 0 });
    expect(r.exhaustive).toBe(false);
    expect(appliedIds(r)).toEqual([1]);
    expect(r.total).toBe(1000);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
    checkMoney(r);
  });

  it('13 candidates over limit 12 -> greedy, exhaustive false, compatible combination', () => {
    const cands = many(13);
    const r = evaluate(cands, [line(1, 100000, 1)], { searchLimit: 12 });
    expect(r.exhaustive).toBe(false);
    assertCompatible(r, cands);
    // Greedy: the largest (13, exclusive) first, then nothing else fits.
    expect(appliedIds(r)).toEqual([13]);
    checkMoney(r);
  });

  it('12 candidates within limit 12 -> exhaustive true, best combination', () => {
    const cands = many(12);
    const r = evaluate(cands, [line(1, 100000, 1)], { searchLimit: 12 });
    expect(r.exhaustive).toBe(true);
    assertCompatible(r, cands);
    // The six stackable (2,4,...,12) sum 110+130+150+170+190+210 = 960 > any single exclusive.
    expect(appliedIds(r)).toEqual([2, 4, 6, 8, 10, 12]);
    expect(r.orderDiscount).toBe(960);
    checkMoney(r);
  });
});

describe('code statuses', () => {
  const benefit: Benefit[] = [{ type: 'ORDER_FIXED', amount: 500 }];
  const cart = [line(1, 10000, 1)];

  it('unknown code -> NOT_FOUND', () => {
    const r = evaluate([], cart, { codes: ['NOPE'] });
    expect(r.codes).toEqual([{ code: 'NOPE', status: 'NOT_FOUND', promotionId: null }]);
  });

  it('code of an AUTOMATIC promotion -> NOT_FOUND (the automatic one still applies)', () => {
    const r = evaluate([promo(1, benefit, { code: 'AUTO' })], cart, { codes: ['AUTO'] });
    expect(r.codes).toEqual([{ code: 'AUTO', status: 'NOT_FOUND', promotionId: null }]);
    expect(appliedIds(r)).toEqual([1]);
  });

  it('a CODE promotion whose code was not entered never applies', () => {
    const r = evaluate([coded(1, 'SECRET', benefit)], cart);
    expect(r.applied).toEqual([]);
    expect(r.evaluated).toEqual([]);
  });

  it('expired -> EXPIRED', () => {
    const r = evaluate([coded(1, 'OLD', benefit, { endsAt: '2026-05-01T00:00:00.000Z' })], cart, {
      codes: ['OLD'],
    });
    expect(r.codes).toEqual([{ code: 'OLD', status: 'EXPIRED', promotionId: 1 }]);
    expect(reasonOf(r, 1)).toBe('EXPIRED');
    expect(r.applied).toEqual([]);
  });

  it('exhausted -> USAGE_LIMIT_REACHED', () => {
    const r = evaluate([coded(1, 'GONE', benefit, { usageLimit: 3, redemptions: 3 })], cart, {
      codes: ['GONE'],
    });
    expect(r.codes[0].status).toBe('USAGE_LIMIT_REACHED');
  });

  it('e-mail not in the list -> EMAIL_NOT_ELIGIBLE (stored e-mails are normalised)', () => {
    const p = coded(1, 'VIP', benefit, {
      eligibility: { mode: 'EMAILS', emails: [' Ana@Example.com '] },
    });
    expect(evaluate([p], cart, { codes: ['VIP'], email: 'bob@example.com' }).codes[0].status).toBe(
      'EMAIL_NOT_ELIGIBLE'
    );
    expect(evaluate([p], cart, { codes: ['VIP'], email: null }).codes[0].status).toBe(
      'EMAIL_NOT_ELIGIBLE'
    );
    expect(evaluate([p], cart, { codes: ['VIP'], email: 'ANA@example.com' }).codes[0].status).toBe(
      'APPLIED'
    );
  });

  it('minimum not reached -> CONDITIONS_NOT_MET', () => {
    const p = coded(1, 'MIN50', benefit, {
      conditions: {
        type: 'GROUP',
        operator: 'AND',
        children: [{ type: 'SUBTOTAL', operator: 'gte', value: 5000 }],
      },
    });
    const r = evaluate([p], [line(1, 4999, 1)], { codes: ['MIN50'] });
    expect(r.codes[0].status).toBe('CONDITIONS_NOT_MET');
    expect(r.evaluated).toEqual([1]);
    expect(r.eligible).toEqual([]);
  });

  it('codes are normalised, de-duplicated and keep the entered order', () => {
    const r = evaluate([coded(1, 'ABC', benefit)], cart, { codes: [' abc', 'ZZZ', 'ABC ', ''] });
    expect(r.codes).toEqual([
      { code: 'ABC', status: 'APPLIED', promotionId: 1 },
      { code: 'ZZZ', status: 'NOT_FOUND', promotionId: null },
    ]);
  });

  it('only free shipping and shipping null -> AWAITING_SHIPPING', () => {
    const r = evaluate([coded(1, 'SHIP', [{ type: 'SHIPPING_FREE', maxAmount: null }])], cart, {
      codes: ['SHIP'],
      shipping: null,
    });
    expect(r.codes[0].status).toBe('AWAITING_SHIPPING');
    expect(r.eligible).toEqual([1]);
    expect(r.applied).toEqual([]);
    expect(r.shippingOriginal).toBeNull();
  });

  it('order + shipping benefits with shipping null -> evaluated on the order part', () => {
    const r = evaluate(
      [
        coded(1, 'MIXED', [
          { type: 'ORDER_FIXED', amount: 300 },
          { type: 'SHIPPING_FREE', maxAmount: null },
        ]),
      ],
      cart,
      { codes: ['MIXED'], shipping: null }
    );
    expect(r.codes[0].status).toBe('APPLIED');
    expect(r.applied[0].amount).toBe(300);
    expect(r.applied[0].benefits.map((b) => b.amount)).toEqual([300, 0]);
    expect(r.total).toBe(9700);
    checkMoney(r);
  });

  it('a failing condition fails closed and is reported through onConditionError', () => {
    const errors: { promotionId: number; type: string }[] = [];
    const p = promo(1, benefit, {
      conditions: {
        type: 'GROUP',
        operator: 'AND',
        children: [
          // malformed: target missing -> the evaluator throws
          { type: 'PRODUCT_QUANTITY', operator: 'gte', value: 1 } as never,
        ],
      },
    });
    const r = evaluate([p], cart, {
      onConditionError: (promotionId, type) => errors.push({ promotionId, type }),
    });
    expect(reasonOf(r, 1)).toBe('CONDITIONS_NOT_MET');
    expect(errors).toEqual([{ promotionId: 1, type: 'PRODUCT_QUANTITY' }]);
  });
});

describe('gifts and cart changes (2.18 / 2.24)', () => {
  const buy2AGetB = promo(1, [
    {
      type: 'BUY_X_GET_Y',
      buy: { target: T(1), quantity: 2, minAmount: null },
      get: { mode: 'GIFT', variantIds: [2], quantity: 1 },
      reward: { kind: 'FREE' },
    },
  ]);
  const giftB: GiftOption = {
    variantId: 2,
    productId: 200,
    unitPrice: 700,
    available: 5,
    active: true,
  };

  it('2 A -> one gift of B, applied (the gift lowers the effective total)', () => {
    const r = evaluate([buy2AGetB], [line(1, 1000, 2), line(2, 700, 1)], { gifts: [giftB] });
    expect(appliedIds(r)).toEqual([1]);
    const gifts = r.lines.filter((l) => l.isGift);
    expect(gifts).toEqual([
      expect.objectContaining({ variantId: 2, quantity: 1, unitDiscount: 700, sourceIndex: null }),
    ]);
    expect(r.applied[0].amount).toBe(700);
    // The bought B line is untouched.
    expect(r.lines.find((l) => l.sourceIndex === 1)).toEqual(
      expect.objectContaining({ variantId: 2, quantity: 1, unitDiscount: 0 })
    );
    checkMoney(r);
  });

  it('the cart shrinks to 1 A -> no gift, NO_BENEFIT, the bought B line intact', () => {
    const r = evaluate([buy2AGetB], [line(1, 1000, 1), line(2, 700, 1)], { gifts: [giftB] });
    expect(r.applied).toEqual([]);
    expect(r.lines.some((l) => l.isGift)).toBe(false);
    expect(reasonOf(r, 1)).toBe('NO_BENEFIT');
    expect(r.eligible).toEqual([1]);
    expect(r.lines).toEqual([
      expect.objectContaining({
        sourceIndex: 0,
        variantId: 1,
        quantity: 1,
        unitDiscount: 0,
        refs: [],
      }),
      expect.objectContaining({
        sourceIndex: 1,
        variantId: 2,
        quantity: 1,
        unitDiscount: 0,
        refs: [],
      }),
    ]);
    expect(r.total).toBe(1700);
    expect(r.totalDiscount).toBe(0);
  });

  it('the gift wins over a smaller cash discount (gift value counts as a benefit)', () => {
    const r = evaluate(
      [
        { ...buy2AGetB, stacking: EXCLUSIVE },
        promo(2, [{ type: 'ORDER_FIXED', amount: 500 }], { stacking: EXCLUSIVE }),
      ],
      [line(1, 1000, 2)],
      { gifts: [giftB] }
    );
    expect(appliedIds(r)).toEqual([1]);
    expect(reasonOf(r, 2)).toBe('CONFLICT');
  });
});

describe('paid gifts (GIFT with a PERCENT reward)', () => {
  const giftB: GiftOption = {
    variantId: 2,
    productId: 200,
    unitPrice: 700,
    available: 5,
    active: true,
  };
  const paidGift = (id: number, percent: number, extra: Benefit[] = []) =>
    promo(id, [
      {
        type: 'BUY_X_GET_Y',
        buy: { target: T(1), quantity: 2, minAmount: null },
        get: { mode: 'GIFT', variantIds: [2], quantity: 1 },
        reward: { kind: 'PERCENT', percent },
      },
      ...extra,
    ]);
  const cart = [line(1, 1000, 2)];

  it('a 50% gift alone is not applied (it would raise the total from 2000 to 2350)', () => {
    const r = evaluate([paidGift(1, 50)], cart, { gifts: [giftB] });
    expect(r.applied).toEqual([]);
    expect(r.lines.some((l) => l.isGift)).toBe(false);
    expect(r.total).toBe(2000);
    expect(reasonOf(r, 1)).toBe('NO_BENEFIT');
  });

  it('a 75% gift alone is not applied either (2175 > 2000)', () => {
    const r = evaluate([paidGift(1, 75)], cart, { gifts: [giftB] });
    expect(r.applied).toEqual([]);
    expect(r.total).toBe(2000);
  });

  it('a paid gift is not stacked with a 10% order discount when it raises the total', () => {
    // {10%} = 1800; {gift + 100 off, 10%} = 2350 - 100 - 235 = 2015.
    const r = evaluate(
      [
        paidGift(1, 50, [{ type: 'ORDER_FIXED', amount: 100 }]),
        promo(2, [{ type: 'ORDER_PERCENT', percent: 10 }]),
      ],
      cart,
      { gifts: [giftB] }
    );
    expect(appliedIds(r)).toEqual([2]);
    expect(r.total).toBe(1800);
    expect(r.lines.some((l) => l.isGift)).toBe(false);
  });

  it('a paid gift whose promotion still lowers the total applies', () => {
    // gift 50% (350 to pay) + 500 off: 2000 + 350 - 500 = 1850 < 2000.
    const r = evaluate([paidGift(1, 50, [{ type: 'ORDER_FIXED', amount: 500 }])], cart, {
      gifts: [giftB],
    });
    expect(appliedIds(r)).toEqual([1]);
    expect(r.total).toBe(1850);
    checkMoney(r);
  });
});

describe('applied promotion shape', () => {
  it('snapshot and version come from the candidate; amount = sum of benefits', () => {
    const p = coded(
      4,
      'MIX',
      [
        { type: 'PRODUCT_PERCENT', target: T(1), percent: 10, maxQuantity: null },
        { type: 'ORDER_FIXED', amount: 300 },
        { type: 'SHIPPING_PERCENT', percent: 50 },
      ],
      {
        version: 7,
        priority: 3,
        perOrderLimit: 2,
        name: 'Mix',
        displayName: { en: 'Mix', pt: 'Misto' },
        eligibility: { mode: 'EMAILS', emails: ['a@b.pt'] },
        conditions: {
          type: 'GROUP',
          operator: 'AND',
          children: [{ type: 'TOTAL_QUANTITY', operator: 'gte', value: 1 }],
        },
      }
    );
    const r = evaluate([p], [line(1, 2000, 2)], { codes: ['mix'], email: 'A@B.PT', shipping: 600 });
    expect(r.applied).toEqual([
      {
        promotionId: 4,
        version: 7,
        name: 'Mix',
        displayName: { en: 'Mix', pt: 'Misto' },
        code: 'MIX',
        method: 'CODE',
        classes: ['ORDER_DISCOUNT', 'PRODUCT_DISCOUNT', 'SHIPPING_DISCOUNT'],
        amount: 400 + 300 + 300,
        benefits: [
          {
            index: 0,
            type: 'PRODUCT_PERCENT',
            class: 'PRODUCT_DISCOUNT',
            amount: 400,
            params: p.benefits[0],
          },
          {
            index: 1,
            type: 'ORDER_FIXED',
            class: 'ORDER_DISCOUNT',
            amount: 300,
            params: p.benefits[1],
          },
          {
            index: 2,
            type: 'SHIPPING_PERCENT',
            class: 'SHIPPING_DISCOUNT',
            amount: 300,
            params: p.benefits[2],
          },
        ],
        snapshot: {
          eligibility: p.eligibility,
          conditions: p.conditions,
          stacking: p.stacking,
          priority: 3,
          perOrderLimit: 2,
        },
      },
    ]);
    expect(r.evaluated).toEqual([4]);
    expect(r.eligible).toEqual([4]);
    expect(r.total).toBe(4000 - 400 - 300 + 600 - 300);
    checkMoney(r);
  });
});
