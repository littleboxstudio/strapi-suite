/**
 * Create order redesign v2 (spec 2026-11-18), server part: selected promotions (`promotionIds`),
 * the applicable promotions of a cart, the promotion code search and several shipping lines.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';

beforeEach(() => __resetEventHandlersForTests());

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};
const DEST = { country: 'PT', postalCode: '1000-001' };
const admin = { actor: 'user:1', source: 'admin' as const };
const ADMIN_QUOTE = { manualDiscounts: true, admin: true };

const STACK_ALL = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };
const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });

const setup = () => {
  const c = setupCommerce();
  c.tables[UIDS.variant].find((v: any) => v.id === 10).stock = 50;
  // A gift variant (catalog price 800).
  c.tables[UIDS.product].push({ id: 3, active: true });
  c.tables[UIDS.productTranslation].push({ id: 3, product: 3, locale: 'en', name: 'Mug' });
  c.tables[UIDS.variant].push({ id: 30, product: 3, sku: 'MUG', price: 800, tax: 23, stock: 10, active: true });
  return c;
};

const addPromotion = (c: Commerce, over: Record<string, unknown> = {}): number => {
  const id = c.tables[UIDS.promotion].length + 1;
  c.tables[UIDS.promotion].push({
    id,
    name: `Promo ${id}`,
    description: null,
    code: null,
    method: 'AUTOMATIC',
    active: true,
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: null,
    priority: 0,
    displayName: { en: `Promo ${id}` },
    eligibility: { mode: 'ALL' },
    conditions: group(),
    benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
    stacking: STACK_ALL,
    usageLimit: null,
    perCustomerLimit: null,
    perOrderLimit: null,
    redemptions: 0,
    version: 1,
    ...over,
  });
  return id;
};
const tenPercent = (c: Commerce) => addPromotion(c);
const fixed300 = (c: Commerce) =>
  addPromotion(c, { benefits: { items: [{ type: 'ORDER_FIXED', amount: 300 }] } });
const freeShipping = (c: Commerce) =>
  addPromotion(c, { name: 'Free shipping', benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] } });
const giftMug = (c: Commerce) =>
  addPromotion(c, {
    name: 'Mug gift',
    perOrderLimit: 1,
    benefits: {
      items: [
        {
          type: 'BUY_X_GET_Y',
          buy: { target: { productIds: [], variantIds: [10] }, quantity: 1, minAmount: null },
          get: { mode: 'GIFT', variantIds: [30], quantity: 1 },
          reward: { kind: 'FREE' },
        },
      ],
    },
  });
const code = (c: Commerce, value: string, over: Record<string, unknown> = {}) =>
  addPromotion(c, {
    method: 'CODE',
    code: value,
    name: `Code ${value}`,
    benefits: { items: [{ type: 'ORDER_FIXED', amount: 500 }] },
    ...over,
  });

const LINES = [{ variantId: 10, quantity: 2 }];
const quoteInput = (extra: Record<string, unknown> = {}) => ({
  locale: 'en',
  email: 'ana@example.pt',
  lines: LINES,
  shipping: { ...DEST, providerId: 'manual', serviceId: '1' },
  ...extra,
});
const createInput = (extra: Record<string, unknown> = {}) => ({
  customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
  shippingAddress: address,
  billingAddress: address,
  locale: 'en',
  lines: LINES,
  shipping: { providerId: 'manual', serviceId: '1' },
  ...extra,
});
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o: any) => o.id === id);
const linesOf = (c: Commerce, id: number) => c.tables[UIDS.orderLine].filter((l: any) => l.order === id);

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

// ---------------------------------------------------------------------------
// 1. Selected promotions
// ---------------------------------------------------------------------------

describe('promotionIds: only the selected automatic promotions', () => {
  it('absent: every automatic promotion is evaluated, as before', async () => {
    const c = setup();
    tenPercent(c);
    const q = await c.orders.quote(quoteInput(), ADMIN_QUOTE);
    expect(q.totals).toMatchObject({ subtotal: 4000, orderDiscount: 400, total: 4100 });
  });

  it('an empty list: no automatic promotion; entered codes still apply', async () => {
    const c = setup();
    tenPercent(c);
    const five = code(c, 'FIVE');
    const q = await c.orders.quote(quoteInput({ promotionIds: [], promotionCodes: ['five'] }), ADMIN_QUOTE);
    expect(q.promotions.map((p: any) => p.promotionId)).toEqual([five]);
    expect(q.totals).toMatchObject({ orderDiscount: 500, total: 4000 });
    const created = await c.orders.create(
      createInput({ promotionIds: [], promotionCodes: ['FIVE'], expectedTotal: q.totals.total }) as any,
      admin
    );
    expect(orderRow(c, created.id).promotions.applied.map((a: any) => a.promotionId)).toEqual([five]);
    const empty = await c.orders.quote(quoteInput({ promotionIds: [] }), ADMIN_QUOTE);
    expect(empty.promotions).toEqual([]);
    expect(empty.totals.total).toBe(4500);
  });

  it('a partial list: only those are applied, reserved and stored', async () => {
    const c = setup();
    tenPercent(c);
    const second = fixed300(c);
    const all = await c.orders.quote(quoteInput(), ADMIN_QUOTE);
    expect(all.promotions).toHaveLength(2);
    const q = await c.orders.quote(quoteInput({ promotionIds: [second] }), ADMIN_QUOTE);
    expect(q.promotions.map((p: any) => p.promotionId)).toEqual([second]);
    expect(q.totals).toMatchObject({ orderDiscount: 300, total: 4200 });
    const created = await c.orders.create(
      createInput({ promotionIds: [second], expectedTotal: 4200 }) as any,
      admin
    );
    expect(created.total).toBe(4200);
    expect(orderRow(c, created.id).promotions.applied.map((a: any) => a.promotionId)).toEqual([second]);
    expect(
      c.tables[UIDS.promotionRedemption].filter((r: any) => r.order === created.id).map((r: any) => r.promotion)
    ).toEqual([second]);
  });

  it('gift options and gift lines follow the selection', async () => {
    const c = setup();
    const gift = giftMug(c);
    const other = tenPercent(c);
    const unselected = await c.orders.quote(quoteInput({ promotionIds: [other] }), ADMIN_QUOTE);
    expect(unselected.giftOptions).toEqual([]);
    expect(unselected.lines.some((l: any) => l.isGift)).toBe(false);
    const selected = await c.orders.quote(quoteInput({ promotionIds: [gift] }), ADMIN_QUOTE);
    expect(selected.giftOptions).toEqual([
      expect.objectContaining({ promotionId: gift, selectedVariantId: 30 }),
    ]);
    expect(selected.lines.find((l: any) => l.isGift)).toMatchObject({ variantId: 30, quantity: 1 });
    const created = await c.orders.create(createInput({ promotionIds: [other] }) as any, admin);
    expect(linesOf(c, created.id).some((l: any) => l.isGift)).toBe(false);
  });

  it('rejects a malformed list', async () => {
    const c = setup();
    expect(await issues(c.orders.quote(quoteInput({ promotionIds: 'x' }), ADMIN_QUOTE))).toEqual([
      { path: 'promotionIds', code: 'invalid' },
    ]);
    expect(
      await issues(c.orders.create(createInput({ promotionIds: [1, 0, 'a'] }) as any, admin))
    ).toEqual([
      { path: 'promotionIds.1', code: 'invalid' },
      { path: 'promotionIds.2', code: 'invalid' },
    ]);
    expect(c.tables[UIDS.order]).toEqual([]);
  });

  it('the storefront ignores it: quote and create apply every automatic promotion', async () => {
    const c = setup();
    tenPercent(c);
    const q = await c.orders.quote(quoteInput({ promotionIds: [] }));
    expect(q.totals.orderDiscount).toBe(400);
    expect(q).not.toHaveProperty('shippingLines');
    const created = await c.orders.create(createInput({ promotionIds: [] }) as any, {
      actor: 'storefront',
      source: 'storefront',
    });
    expect(created.total).toBe(4100);
  });
});

// ---------------------------------------------------------------------------
// 2. Applicable promotions
// ---------------------------------------------------------------------------

describe('applicablePromotions', () => {
  const input = (extra: Record<string, unknown> = {}) => ({
    locale: 'en',
    email: 'ana@example.pt',
    lines: LINES,
    shippingLines: [{ providerId: 'manual', serviceId: '1', amount: 500 }],
    ...extra,
  });

  it('lists the active automatic promotions the cart gets, with their amount; writes nothing', async () => {
    const c = setup();
    const ten = tenPercent(c);
    const free = freeShipping(c);
    addPromotion(c, { active: false });
    addPromotion(c, { conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 1_000_000 }]) });
    code(c, 'FIVE');
    const before = JSON.stringify(c.tables);
    const res = await c.orders.applicablePromotions(input());
    expect(JSON.stringify(c.tables)).toBe(before);
    expect(res.promotions).toEqual([
      expect.objectContaining({
        id: ten,
        name: `Promo ${ten}`,
        displayName: { en: `Promo ${ten}` },
        classes: ['ORDER_DISCOUNT'],
        benefits: [{ type: 'ORDER_PERCENT', percent: 10 }],
        amount: 400,
      }),
      expect.objectContaining({ id: free, classes: ['SHIPPING_DISCOUNT'], amount: 500 }),
    ]);
    expect(res.exhaustive).toBe(true);
  });

  it('a free shipping promotion is worth the sum of the shipping lines', async () => {
    const c = setup();
    const free = freeShipping(c);
    const res = await c.orders.applicablePromotions(
      input({
        shippingLines: [
          { providerId: 'manual', serviceId: '1', amount: 500 },
          { providerId: 'manual', serviceId: '2', amount: 250 },
        ],
      })
    );
    expect(res.promotions).toEqual([expect.objectContaining({ id: free, amount: 750 })]);
  });

  it('lists a gift promotion with the value of its gift; codes are not listed', async () => {
    const c = setup();
    const gift = giftMug(c);
    code(c, 'FIVE');
    const res = await c.orders.applicablePromotions(input({ promotionCodes: ['FIVE'] }));
    expect(res.promotions).toEqual([expect.objectContaining({ id: gift, amount: 800 })]);
  });

  it('rejects an invalid cart', async () => {
    const c = setup();
    expect(await issues(c.orders.applicablePromotions(input({ lines: [], locale: '' })))).toEqual(
      expect.arrayContaining([
        { path: 'lines', code: 'required' },
        { path: 'locale', code: 'required' },
      ])
    );
    expect(
      await issues(c.orders.applicablePromotions(input({ shippingLines: [{ amount: -1 }] })))
    ).toEqual([{ path: 'shippingLines.0.amount', code: 'INVALID_AMOUNT' }]);
  });
});

describe('applicablePromotions: a recommender like the order detail', () => {
  const input = (extra: Record<string, unknown> = {}) => ({
    locale: 'en',
    email: 'ana@example.pt',
    lines: LINES,
    shippingLines: [{ providerId: 'manual', serviceId: '1', amount: 500 }],
    ...extra,
  });
  const exclusive = (c: Commerce, percent = 30) =>
    addPromotion(c, {
      name: 'VIP',
      stacking: { ...STACK_ALL, exclusive: true },
      benefits: { items: [{ type: 'ORDER_PERCENT', percent }] },
    });

  it('every eligible promotion at its own amount; their conflict; the best recommended', async () => {
    const c = setup();
    const vip = exclusive(c);
    const ten = tenPercent(c);
    const res = await c.orders.applicablePromotions(input());
    expect(res.promotions.map((p: any) => [p.id, p.amount, p.recommended, p.blockedBy])).toEqual([
      [vip, 1200, true, null],
      [ten, 400, false, null],
    ]);
    expect(res.conflicts).toEqual([
      {
        ids: [vip, ten],
        reasons: [
          { rule: 'EXCLUSIVE_SELF', discountClass: null },
          { rule: 'EXCLUSIVE_OTHER', discountClass: null },
        ],
      },
    ]);
  });

  it('a promotion that does not stack with an entered code is blocked by it', async () => {
    const c = setup();
    const five = code(c, 'FIVE', { stacking: { ...STACK_ALL, exclusive: true } });
    const ten = tenPercent(c);
    const res = await c.orders.applicablePromotions(input({ promotionCodes: ['FIVE'] }));
    expect(res.promotions).toEqual([
      expect.objectContaining({
        id: ten,
        recommended: false,
        blockedBy: {
          kind: 'PROMOTION',
          promotionId: five,
          name: 'Code FIVE',
          displayName: { en: `Promo ${five}` },
          conflict: { rule: 'EXCLUSIVE_OTHER', discountClass: null },
        },
      }),
    ]);
  });

  it('with a manual discount in the draft, an exclusive one (or one without order discounts) is blocked', async () => {
    const c = setup();
    const vip = exclusive(c);
    const noOrder = addPromotion(c, {
      name: 'Ship',
      stacking: { ...STACK_ALL, withOrder: false },
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });
    const ten = tenPercent(c);
    const res = await c.orders.applicablePromotions(input({ manualDiscount: true }));
    const byId = new Map<number, any>(res.promotions.map((p: any) => [p.id, p]));
    expect(byId.get(vip).blockedBy).toEqual({
      kind: 'MANUAL',
      promotionId: null,
      name: '',
      displayName: {},
      conflict: { rule: 'EXCLUSIVE_SELF', discountClass: null },
    });
    expect(byId.get(noOrder).blockedBy).toMatchObject({
      kind: 'MANUAL',
      conflict: { rule: 'CLASS_SELF', discountClass: 'ORDER_DISCOUNT' },
    });
    expect(byId.get(ten)).toMatchObject({ blockedBy: null, recommended: true });
    expect(res.conflicts).toEqual([]);
  });

  it('a gift promotion comes with its gift options', async () => {
    const c = setup();
    const gift = giftMug(c);
    const res = await c.orders.applicablePromotions(input());
    expect(res.giftOptions).toEqual([
      {
        promotionId: gift,
        benefitIndex: 0,
        quantity: 1,
        selectedVariantId: 30,
        variants: [expect.objectContaining({ variantId: 30, sku: 'MUG', available: true })],
      },
    ]);
  });

  it('quote and create refuse promotionIds that do not stack (PROMOTIONS_NOT_COMBINABLE on promotionIds)', async () => {
    const c = setup();
    const vip = exclusive(c);
    const ten = tenPercent(c);
    const refused = [{ path: 'promotionIds', code: 'PROMOTIONS_NOT_COMBINABLE' }];
    expect(
      await issues(c.orders.quote(quoteInput({ promotionIds: [vip, ten] }), ADMIN_QUOTE))
    ).toEqual(refused);
    expect(
      await issues(c.orders.create(createInput({ promotionIds: [vip, ten] }) as any, admin))
    ).toEqual(refused);
    expect(c.tables[UIDS.order]).toEqual([]);
    // With a code that does not stack, or a manual discount.
    const five = code(c, 'FIVE', { stacking: { ...STACK_ALL, exclusive: true } });
    expect(
      await issues(c.orders.quote(quoteInput({ promotionIds: [ten], promotionCodes: ['FIVE'] }), ADMIN_QUOTE))
    ).toEqual(refused);
    expect(five).toBeGreaterThan(0);
    expect(
      await issues(
        c.orders.quote(
          quoteInput({
            promotionIds: [vip],
            manualDiscounts: [{ kind: 'FIXED', value: 100, reason: 'Loyal' }],
          }),
          ADMIN_QUOTE
        )
      )
    ).toEqual(refused);
    // One of them alone is fine.
    const q = await c.orders.quote(quoteInput({ promotionIds: [ten] }), ADMIN_QUOTE);
    expect(q.promotions.map((p: any) => p.promotionId)).toEqual([ten]);
  });
});

// ---------------------------------------------------------------------------
// 3. Promotion code search
// ---------------------------------------------------------------------------

describe('searchCodes', () => {
  it('active CODE promotions whose code contains q (any case), prefix matches first, no customer data', async () => {
    const c = setup();
    const summer = code(c, 'SUMMER10', { displayName: { en: 'Summer' } });
    const insummer = code(c, 'XSUMMER');
    code(c, 'SUMMEROFF', { active: false });
    code(c, 'SUMMEROLD', { endsAt: '2021-01-01T00:00:00.000Z' });
    code(c, 'WINTER');
    tenPercent(c);
    const promotions = c.services.EcommercePromotionService;
    const res = await promotions.searchCodes('sum');
    expect(res.results).toEqual([
      {
        code: 'SUMMER10',
        promotionId: summer,
        name: `Code SUMMER10`,
        displayName: { en: 'Summer' },
        classes: ['ORDER_DISCOUNT'],
        benefits: [{ type: 'ORDER_FIXED', amount: 500 }],
      },
      expect.objectContaining({ code: 'XSUMMER', promotionId: insummer }),
    ]);
    expect((await promotions.searchCodes('')).results).toEqual([]);
    expect((await promotions.searchCodes('  s ')).results.map((r: any) => r.code)).toEqual([
      'SUMMER10',
      'XSUMMER',
    ]);
  });

  it('caps the results at 20', async () => {
    const c = setup();
    for (let i = 0; i < 25; i += 1) code(c, `BULK${String(i).padStart(2, '0')}`);
    const res = await c.services.EcommercePromotionService.searchCodes('bulk');
    expect(res.results).toHaveLength(20);
    expect(res.results[0].code).toBe('BULK00');
  });
});

// ---------------------------------------------------------------------------
// 4. Several shipping lines
// ---------------------------------------------------------------------------

describe('shippingLines: several admin shipping charges', () => {
  const TWO_LINES = [
    { providerId: 'manual', serviceId: '1', amount: 700 },
    { providerId: 'manual', serviceId: '2', amount: 300 },
  ];
  const quoteLines = (extra: Record<string, unknown> = {}) =>
    quoteInput({ shipping: undefined, destination: DEST, shippingLines: TWO_LINES, ...extra });
  const createLines = (extra: Record<string, unknown> = {}) =>
    createInput({ shipping: undefined, shippingLines: TWO_LINES, ...extra });

  it('quote, create and the order view agree to the cent; the lines are stored with origin CREATE', async () => {
    const c = setup();
    tenPercent(c);
    const q = await c.orders.quote(quoteLines(), ADMIN_QUOTE);
    expect(q.totals).toMatchObject({
      subtotal: 4000,
      orderDiscount: 400,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      shippingTotal: 1000,
      total: 4600,
    });
    expect(q.shippingLines).toEqual([
      { providerId: 'manual', serviceId: '1', name: 'Standard', tax: 23, amount: 700 },
      { providerId: 'manual', serviceId: '2', name: 'Express', tax: 23, amount: 300 },
    ]);
    expect(q.shippingOption).toMatchObject({ providerId: 'manual', serviceId: '1', price: 700 });

    const created = await c.orders.create(
      createLines({ expectedTotal: q.totals.total, idempotencyKey: 'lines-1' }) as any,
      admin
    );
    expect(created.total).toBe(4600);
    const row = orderRow(c, created.id);
    expect(row).toMatchObject({
      shippingOriginal: 1000,
      shippingDiscount: 0,
      shippingTotal: 1000,
      shippingTax: 23,
      total: 4600,
      shippingMethod: { providerId: 'manual', serviceId: '1', name: 'Standard', price: 700, tax: 23 },
    });
    expect(row.shippingLines.lines).toEqual([
      expect.objectContaining({ id: 1, origin: 'CREATE', amount: 700, providerId: 'manual', serviceId: '1', name: 'Standard', tax: 23, actor: 'user:1' }),
      expect.objectContaining({ id: 2, origin: 'CREATE', amount: 300, providerId: 'manual', serviceId: '2', name: 'Express', tax: 23, actor: 'user:1', extra: true }),
    ]);
    expect(row.shippingLines.lines[0].extra).toBeUndefined();

    const view = await c.orders.get(created.id);
    expect(view.totals).toMatchObject({
      shippingOriginal: 1000,
      shippingDiscount: 0,
      shippingTotal: 1000,
      total: 4600,
    });
    expect(view.summary.due).toBe(4600);
    expect(view.shippingLines.map((l: any) => [l.id, l.origin, l.name, l.amount, l.paid])).toEqual([
      [1, 'CREATE', 'Standard', 700, false],
      [2, 'CREATE', 'Express', 300, false],
    ]);
    expect(view.shippingMethod).toMatchObject({ providerId: 'manual', serviceId: '1' });
  });

  it('a free shipping promotion takes the whole shipping total (quote = create = view)', async () => {
    const c = setup();
    freeShipping(c);
    const q = await c.orders.quote(quoteLines(), ADMIN_QUOTE);
    expect(q.totals).toMatchObject({
      shippingOriginal: 1000,
      shippingDiscount: 1000,
      shippingTotal: 0,
      total: 4000,
    });
    const created = await c.orders.create(createLines({ expectedTotal: 4000 }) as any, admin);
    expect(orderRow(c, created.id)).toMatchObject({
      shippingOriginal: 1000,
      shippingDiscount: 1000,
      shippingTotal: 0,
      total: 4000,
    });
    const view = await c.orders.get(created.id);
    expect(view.totals).toMatchObject({ shippingOriginal: 1000, shippingDiscount: 1000, shippingTotal: 0, total: 4000 });
    expect(view.shippingLines.map((l: any) => l.amount)).toEqual([700, 300]);
    // The order's own discount recalculation reads the same shipping.
    const preview = await c.editing.previewDiscounts(created.id, {});
    expect(preview.before.total).toBe(4000);
    expect(preview.after.total).toBe(4000);
  });

  it('with manual discounts and selected promotions the totals still reconcile', async () => {
    const c = setup();
    tenPercent(c);
    const free = freeShipping(c);
    const manual = [{ kind: 'FIXED', value: 250, reason: 'Gesture' }];
    const q = await c.orders.quote(quoteLines({ promotionIds: [free], manualDiscounts: manual }), ADMIN_QUOTE);
    expect(q.totals).toMatchObject({ orderDiscount: 250, shippingTotal: 0, total: 3750 });
    const created = await c.orders.create(
      createLines({ promotionIds: [free], manualDiscounts: manual, expectedTotal: q.totals.total }) as any,
      admin
    );
    expect(created.total).toBe(3750);
    const view = await c.orders.get(created.id);
    expect(view.totals.total).toBe(3750);
  });

  it('the first line is the delivery method; an amount of 0 is allowed', async () => {
    const c = setup();
    const created = await c.orders.create(
      createLines({
        shippingLines: [
          { providerId: 'manual', serviceId: '2', amount: 0 },
          { providerId: 'manual', serviceId: '1', amount: 450 },
        ],
      }) as any,
      admin
    );
    const row = orderRow(c, created.id);
    expect(row.shippingMethod).toMatchObject({ providerId: 'manual', serviceId: '2', name: 'Express', price: 0 });
    expect(row).toMatchObject({ shippingOriginal: 450, total: 4450 });
    const { currentMethod, readShippingLines } = await import(
      '../../../server/src/services/modules/ecommerce/domain/shippingLines'
    );
    expect(currentMethod(readShippingLines(row))).toMatchObject({ providerId: 'manual', serviceId: '2' });
  });

  it('both shipping and shippingLines → 400 on quote and create', async () => {
    const c = setup();
    const both = { shippingLines: TWO_LINES };
    expect(
      await issues(c.orders.quote(quoteInput({ ...both, destination: DEST }), ADMIN_QUOTE))
    ).toEqual([{ path: 'shippingLines', code: 'exclusive' }]);
    expect(await issues(c.orders.create(createInput(both) as any, admin))).toEqual([
      { path: 'shippingLines', code: 'exclusive' },
    ]);
    expect(c.tables[UIDS.order]).toEqual([]);
  });

  it('validates each line: amounts in whole cents ≥ 0, a method, a configured method', async () => {
    const c = setup();
    expect(
      await issues(
        c.orders.create(
          createLines({
            shippingLines: [
              { providerId: 'manual', serviceId: '1', amount: -1 },
              { providerId: 'manual', serviceId: '1', amount: 1.5 },
              { providerId: 'manual', serviceId: '1', amount: '100' },
              { providerId: '', serviceId: '1', amount: 100 },
            ],
          }) as any,
          admin
        )
      )
    ).toEqual([
      { path: 'shippingLines.0.amount', code: 'INVALID_AMOUNT' },
      { path: 'shippingLines.1.amount', code: 'INVALID_AMOUNT' },
      { path: 'shippingLines.2.amount', code: 'INVALID_AMOUNT' },
      { path: 'shippingLines.3', code: 'required' },
    ]);
    expect(await issues(c.orders.create(createLines({ shippingLines: [] }) as any, admin))).toEqual([
      { path: 'shippingLines', code: 'required' },
    ]);
    expect(await issues(c.orders.create(createLines({ shippingLines: 'x' }) as any, admin))).toEqual([
      { path: 'shippingLines', code: 'invalid' },
    ]);
    const eleven = Array.from({ length: 11 }, () => ({ providerId: 'manual', serviceId: '1', amount: 1 }));
    expect(await issues(c.orders.create(createLines({ shippingLines: eleven }) as any, admin))).toEqual([
      { path: 'shippingLines', code: 'too_many' },
    ]);
    const unknown = [
      { providerId: 'manual', serviceId: '1', amount: 100 },
      { providerId: 'manual', serviceId: '9', amount: 100 },
      { providerId: 'ctt', serviceId: 'X', amount: 100 },
    ];
    expect(await issues(c.orders.create(createLines({ shippingLines: unknown }) as any, admin))).toEqual([
      { path: 'shippingLines.1', code: 'SHIPPING_METHOD_UNAVAILABLE' },
      { path: 'shippingLines.2', code: 'SHIPPING_QUOTE_FAILED' },
    ]);
    expect(
      await issues(c.orders.quote(quoteLines({ shippingLines: unknown }), ADMIN_QUOTE))
    ).toEqual([
      { path: 'shippingLines.1', code: 'SHIPPING_METHOD_UNAVAILABLE' },
      { path: 'shippingLines.2', code: 'SHIPPING_QUOTE_FAILED' },
    ]);
    expect(
      await issues(c.orders.quote(quoteLines({ destination: undefined }), ADMIN_QUOTE))
    ).toEqual([{ path: 'destination.country', code: 'required' }]);
    expect(c.tables[UIDS.order]).toEqual([]);
  });

  it('the methods are checked against a quote of the parcel with its gifts', async () => {
    const c = setup();
    giftMug(c);
    await c.orders.quote(quoteLines(), ADMIN_QUOTE);
    const quote = c.services.EcommerceShippingService.quote;
    const req = quote.mock.calls[quote.mock.calls.length - 1][0];
    expect(req).toMatchObject({ country: 'PT', postalCode: '1000-001', locale: 'en', subtotal: 4000 });
    expect(req.items.map((i: any) => [i.variantId, i.quantity])).toEqual([
      [10, 2],
      [30, 1],
    ]);
  });

  it('a pickup method on the first line needs its point, as the single shipping does', async () => {
    const c = setup();
    const POINT = {
      id: 'PT12345',
      name: 'Papelaria Central',
      address: 'Rua do Ponto 10',
      address2: null,
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
    };
    const findPoint = vi.fn(async (_pc: string, id: string) => (id === POINT.id ? POINT : null));
    c.services.EcommercePickupPointService = { findPoint, search: vi.fn() };
    const pickupOption = { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup', price: 400, tax: 23 };
    c.services.EcommerceShippingService.quote = vi.fn(async () => ({
      options: [{ providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, tax: 23 }, pickupOption],
      failures: [],
    }));
    const pickupLines = (point: Record<string, unknown>) => [
      { providerId: 'dpd-portugal', serviceId: 'PICKUP', amount: 400, ...point },
      { providerId: 'manual', serviceId: '1', amount: 200 },
    ];
    expect(
      await issues(c.orders.create(createLines({ shippingLines: pickupLines({}) }) as any, admin))
    ).toEqual([{ path: 'shippingLines.0.pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    const created = await c.orders.create(
      createLines({ shippingLines: pickupLines({ pickupPointId: POINT.id, pickupPostalCode: '4000-200' }) }) as any,
      admin
    );
    expect(findPoint).toHaveBeenCalledWith('4000-200', POINT.id);
    const row = orderRow(c, created.id);
    expect(row.pickupPoint).toMatchObject({ id: POINT.id });
    expect(row.shippingAddress).toMatchObject({ postalCode: '4000-200', company: 'Papelaria Central' });
    expect(row).toMatchObject({ shippingOriginal: 600, total: 4600 });
  });

  it('editing a line on the order never moves the delivery method to another line', async () => {
    const c = setup();
    const POINT = {
      id: 'PT12345',
      name: 'Papelaria Central',
      address: 'Rua do Ponto 10',
      address2: null,
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
    };
    c.services.EcommercePickupPointService = { findPoint: vi.fn(async () => POINT), search: vi.fn() };
    const standard = { providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, tax: 23 };
    const pickup = { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup', price: 400, tax: 23, requiresPickupPoint: true };
    c.services.EcommerceShippingService.quote = vi.fn(async () => ({ options: [standard, pickup], failures: [] }));
    const created = await c.orders.create(
      createLines({
        shippingLines: [
          { providerId: 'manual', serviceId: '1', amount: 500 },
          { providerId: 'dpd-portugal', serviceId: 'PICKUP', amount: 400 },
        ],
      }) as any,
      admin
    );
    const method = () => orderRow(c, created.id).shippingMethod;
    expect(method()).toMatchObject({ providerId: 'manual', serviceId: '1' });

    // Line 1's amount: still the delivery line, and no pickup point is asked for.
    await c.editing.editShippingLine(created.id, 1, { providerId: 'manual', serviceId: '1', amount: 650 }, 'user:1', 'op-create-0001');
    expect(method()).toMatchObject({ providerId: 'manual', serviceId: '1' });
    expect(orderRow(c, created.id).pickupPoint ?? null).toBeNull();
    const { currentMethod, readShippingLines } = await import(
      '../../../server/src/services/modules/ecommerce/domain/shippingLines'
    );
    expect(currentMethod(readShippingLines(orderRow(c, created.id)))).toMatchObject({ providerId: 'manual', serviceId: '1' });

    // Line 2's amount: it stays an extra charge.
    await c.editing.editShippingLine(created.id, 2, { providerId: 'dpd-portugal', serviceId: 'PICKUP', amount: 300 }, 'user:1', 'op-create-0002');
    expect(method()).toMatchObject({ providerId: 'manual', serviceId: '1' });
    expect(currentMethod(readShippingLines(orderRow(c, created.id)))).toMatchObject({ providerId: 'manual', serviceId: '1' });
  });

  it('admin create with shipping lines finds the customer by e-mail or creates one with the order language', async () => {
    const c = setup();
    const first = await c.orders.create(createLines({ locale: 'pt', idempotencyKey: 'cust-1' }) as any, admin);
    const customers = c.tables[UIDS.customer];
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ email: 'ana@example.pt', locale: 'pt' });
    expect(orderRow(c, first.id).customer).toBe(customers[0].id);
    // The same e-mail (any case) is the same customer; their language is kept.
    const second = await c.orders.create(
      createLines({
        locale: 'en',
        idempotencyKey: 'cust-2',
        customer: { firstName: 'Ana', lastName: 'S', email: 'ANA@Example.pt' },
      }) as any,
      admin
    );
    expect(c.tables[UIDS.customer]).toHaveLength(1);
    expect(orderRow(c, second.id).customer).toBe(customers[0].id);
    expect(customers[0].locale).toBe('pt');
  });

  it('the storefront ignores shippingLines and keeps the single shipping', async () => {
    const c = setup();
    const created = await c.orders.create(createInput({ shippingLines: TWO_LINES }) as any, {
      actor: 'storefront',
      source: 'storefront',
    });
    const row = orderRow(c, created.id);
    expect(row.shippingLines.lines).toEqual([expect.objectContaining({ id: 1, origin: 'CHECKOUT', amount: 500 })]);
    expect(row.total).toBe(4500);
  });

  it('the admin single shipping is unchanged (CHECKOUT line priced by the carrier)', async () => {
    const c = setup();
    const q = await c.orders.quote(quoteInput(), ADMIN_QUOTE);
    expect(q.shippingLines).toEqual([
      { providerId: 'manual', serviceId: '1', name: 'Standard', tax: 23, amount: 500 },
    ]);
    const created = await c.orders.create(createInput() as any, admin);
    expect(orderRow(c, created.id).shippingLines.lines).toEqual([
      expect.objectContaining({ id: 1, origin: 'CHECKOUT', amount: 500 }),
    ]);
  });
});
