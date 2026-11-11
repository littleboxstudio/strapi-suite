import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';

import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { computeTotals } from '../../../server/src/services/modules/ecommerce/domain/orders';
import { UIDS, setupCommerce, type Commerce } from './helpers/commerceSetup';

const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
const STACK_ALL = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };
const T = (variantIds: number[] = [], productIds: number[] = []) => ({ productIds, variantIds });

/** A stored promotion row (as the admin service writes it). */
const row = (over: Record<string, unknown> = {}) => ({
  name: 'Promo',
  description: null,
  code: null,
  method: 'AUTOMATIC',
  active: true,
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  priority: 0,
  displayName: {},
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

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const errorsOf = async (
  p: Promise<unknown>
): Promise<{ path: string; code: string; detail?: string }[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors as any;
    throw e;
  }
  return [];
};

const usageKey = (promotionId: number, email: string) =>
  `p${promotionId}:${createHash('sha256').update(email).digest('hex')}`;

let c: Commerce;
let promoSvc: any;
let nextPromotionId = 1;

const addPromotion = (over: Record<string, unknown> = {}): number => {
  const id = nextPromotionId++;
  c.tables[UIDS.promotion].push({ id, ...row(over) });
  return id;
};
const promotionRow = (id: number) => c.tables[UIDS.promotion].find((p) => p.id === id);

const addVariant = (id: number, productId: number, price: number, stock: number, name: string) => {
  if (!c.tables[UIDS.product].some((p) => p.id === productId)) {
    c.tables[UIDS.product].push({ id: productId, active: true });
    c.tables[UIDS.productTranslation].push({
      id: 100 + productId,
      product: productId,
      locale: 'en',
      name,
    });
  }
  c.tables[UIDS.variant].push({
    id,
    product: productId,
    sku: `SKU-${id}`,
    price,
    tax: 23,
    stock,
    active: true,
  });
};
const stockOf = (variantId: number) => c.tables[UIDS.variant].find((v) => v.id === variantId).stock;

const createInput = (over: Record<string, unknown> = {}): any => ({
  customer: { firstName: 'Ana', lastName: 'Silva', email: 'Ana@Example.pt' },
  shippingAddress: address,
  billingAddress: address,
  locale: 'en',
  lines: [{ variantId: 10, quantity: 2 }],
  shipping: { providerId: 'manual', serviceId: '1' },
  ...over,
});
const create = (over: Record<string, unknown> = {}) =>
  c.orders.create(createInput(over), { actor: 'user:1', source: 'admin' });

const orderRow = (id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const linesOf = (id: number) =>
  c.tables[UIDS.orderLine].filter((l) => l.order === id).sort((a, b) => a.position - b.position);
const historyOf = (id: number, type: string) =>
  c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === type);

/** The stored totals are exactly what computeTotals derives from the stored lines. */
const expectTotalsConsistent = (id: number) => {
  const o = orderRow(id);
  const t = computeTotals(linesOf(id), {
    orderDiscount: o.orderDiscount,
    shippingOriginal: o.shippingOriginal,
    shippingDiscount: o.shippingDiscount,
  });
  expect({
    itemsOriginal: o.itemsOriginal,
    productDiscount: o.productDiscount,
    subtotal: o.subtotal,
    orderDiscount: o.orderDiscount,
    shippingTotal: o.shippingTotal,
    total: o.total,
  }).toEqual({
    itemsOriginal: t.itemsOriginal,
    productDiscount: t.productDiscount,
    subtotal: t.subtotal,
    orderDiscount: t.orderDiscount,
    shippingTotal: t.shippingTotal,
    total: t.total,
  });
};

const setShippingPrice = (price: number) => {
  const findOption = vi.fn(async (_req: any, providerId: string, serviceId: string) => ({
    providerId,
    serviceId,
    name: 'Standard',
    price,
    tax: 23,
  }));
  c.services.EcommerceShippingService = { findOption };
  return findOption;
};

beforeEach(() => {
  __resetEventHandlersForTests();
  c = setupCommerce();
  promoSvc = c.services.EcommercePromotionService;
  nextPromotionId = 1;
});

describe('orders with promotions: create', () => {
  it('Review Focus 1: the last use of a code taken meanwhile → 409 PROMOTION_UNAVAILABLE, nothing written', async () => {
    const id = addPromotion({ method: 'CODE', code: 'ULTIMO', usageLimit: 1, redemptions: 1 });
    // The candidates were read before the other checkout committed.
    const real = promoSvc.loadCandidates;
    vi.spyOn(promoSvc, 'loadCandidates').mockImplementation(async (p: any) =>
      (await real(p)).map((x: any) => ({ ...x, redemptions: 0 }))
    );

    const errors = await errorsOf(create({ promotionCodes: ['ultimo'] }));

    expect(errors).toEqual([
      { path: `promotions.${id}`, code: 'PROMOTION_UNAVAILABLE', detail: 'ULTIMO' },
    ]);
    expect(c.tables[UIDS.order]).toHaveLength(0);
    expect(c.tables[UIDS.orderLine]).toHaveLength(0);
    expect(c.tables[UIDS.stockMovement]).toHaveLength(0);
    expect(c.tables[UIDS.promotionRedemption]).toHaveLength(0);
    expect(stockOf(10)).toBe(5);
    expect(promotionRow(id).redemptions).toBe(1);
  });

  it('a code whose limit is already reached (fresh candidates) → 409 PROMOTION_UNAVAILABLE', async () => {
    const id = addPromotion({ method: 'CODE', code: 'ULTIMO', usageLimit: 1, redemptions: 1 });
    expect(await errorsOf(create({ promotionCodes: ['ULTIMO'] }))).toEqual([
      { path: `promotions.${id}`, code: 'PROMOTION_UNAVAILABLE', detail: 'ULTIMO' },
    ]);
    expect(c.tables[UIDS.order]).toHaveLength(0);
  });

  it('Review Focus 3: "buy 2 A, get 1 A" as a GIFT → one deduction of 3, cancel restocks 3', async () => {
    const id = addPromotion({
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds: [10], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const findOption = setShippingPrice(500);

    const order = await create();

    const lines = linesOf(order.id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      variantId: 10,
      quantity: 2,
      unitDiscount: 0,
      isGift: false,
      position: 0,
    });
    expect(lines[1]).toMatchObject({
      variantId: 10,
      quantity: 1,
      unitPrice: 2000,
      unitDiscount: 2000,
      isGift: true,
      position: 1,
      promotionRefs: { refs: [{ promotionId: id, benefitIndex: 0, amount: 2000 }] },
    });
    expect(lines[0].promotionRefs).toEqual({ refs: [] });
    const deducts = c.tables[UIDS.stockMovement].filter((m) => m.type === 'ORDER_DEDUCT');
    expect(deducts).toHaveLength(1);
    expect(deducts[0]).toMatchObject({
      variantId: 10,
      quantity: -3,
      operationKey: `order:${order.id}:create:10`,
    });
    expect(stockOf(10)).toBe(2);
    expect(orderRow(order.id)).toMatchObject({
      itemsOriginal: 6000,
      productDiscount: 2000,
      subtotal: 4000,
      total: 4500,
    });
    expectTotalsConsistent(order.id);

    // The gift is part of the parcel the carrier quotes.
    for (const call of findOption.mock.calls) {
      expect(call[0].items).toEqual([expect.objectContaining({ variantId: 10, quantity: 3 })]);
    }

    const view = await c.orders.get(order.id);
    expect(view.lines.map((l: any) => l.promotionIds)).toEqual([[], [id]]);
    expect(view.lines[1].isGift).toBe(true);

    await c.orders.cancel(order.id, 'user:1');
    expect(stockOf(10)).toBe(5);
  });

  it('Review Focus 4: the order keeps the 10% snapshot after the promotion changes to 50%', async () => {
    const id = addPromotion();
    const order = await create();
    expect(orderRow(order.id)).toMatchObject({ orderDiscount: 400, total: 4100 });

    Object.assign(promotionRow(id), {
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 50 }] },
      version: 2,
    });

    const view = await c.orders.get(order.id);
    expect(view.totals.orderDiscount).toBe(400);
    expect(view.totals.total).toBe(4100);
    expect(view.promotions).toHaveLength(1);
    expect(view.promotions[0]).toMatchObject({
      promotionId: id,
      version: 1,
      amount: 400,
      redemptionStatus: 'RESERVED',
      benefits: [{ index: 0, type: 'ORDER_PERCENT', amount: 400, params: { percent: 10 } }],
    });

    const q = await c.orders.quote({ lines: [{ variantId: 10, quantity: 2 }], locale: 'en' });
    expect(q.totals.orderDiscount).toBe(2000);
    expect(q.promotions[0]).toMatchObject({ promotionId: id, version: 2 });
  });

  it('Review Focus 5: the history shows the code VERAO20 in full; the order stores the evaluation', async () => {
    const id = addPromotion({
      method: 'CODE',
      code: 'VERAO20',
      name: 'Verão',
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 20 }] },
    });
    const order = await create({ promotionCodes: ['verao20'] });

    const stored = orderRow(order.id);
    expect(stored.promotions).toMatchObject({
      applied: [{ promotionId: id, code: 'VERAO20', amount: 800 }],
      codes: [{ code: 'VERAO20', status: 'APPLIED', promotionId: id }],
      exhaustive: true,
    });
    expect(typeof stored.promotions.evaluatedAt).toBe('string');

    const view = await c.orders.get(order.id);
    expect(view.promotionCodes).toEqual([{ code: 'VERAO20', status: 'APPLIED', promotionId: id }]);
    const applied = view.history.filter((h: any) => h.type === 'PROMOTIONS_APPLIED');
    expect(applied).toHaveLength(1);
    expect(applied[0].newValue).toEqual({
      promotions: [{ promotionId: id, promotionCode: 'VERAO20', amount: 800 }],
    });
    expect(applied[0].description).toBe('Promotions applied: Verão (VERAO20)');
    expect(applied[0].actor).toBe('user:1');

    expect(promotionRow(id).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionRedemption]).toEqual([
      expect.objectContaining({
        promotion: id,
        order: order.id,
        status: 'RESERVED',
        amount: 800,
        promotionCode: 'VERAO20',
      }),
    ]);
  });

  it('Review Focus 2: cancel releases once; a second cancel is refused and changes nothing', async () => {
    const id = addPromotion({ method: 'CODE', code: 'VERAO20', perCustomerLimit: 3 });
    const order = await create({ promotionCodes: ['VERAO20'] });
    const usage = () =>
      c.tables[UIDS.promotionCustomerUsage].find(
        (u) => u.uniqueKey === usageKey(id, 'ana@example.pt')
      );
    expect(promotionRow(id).redemptions).toBe(1);
    expect(usage().uses).toBe(1);

    await c.orders.cancel(order.id, 'user:2');
    expect(c.tables[UIDS.promotionRedemption][0].status).toBe('RELEASED');
    expect(promotionRow(id).redemptions).toBe(0);
    expect(usage().uses).toBe(0);
    const released = historyOf(order.id, 'PROMOTIONS_RELEASED');
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({
      actor: 'user:2',
      newValue: { promotions: [{ promotionId: id, promotionCode: 'VERAO20', amount: 400 }] },
      description: 'Promotions released: Promo (VERAO20)',
    });
    const cancelled = historyOf(order.id, 'ORDER_CANCELLED')[0];
    expect(released[0].operationId).toBe(cancelled.operationId);
    expect((await c.orders.get(order.id)).promotions[0].redemptionStatus).toBe('RELEASED');

    expect((await errorsOf(c.orders.cancel(order.id, 'user:2'))).map((e) => e.code)).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    expect(promotionRow(id).redemptions).toBe(0);
    expect(usage().uses).toBe(0);
    expect(historyOf(order.id, 'PROMOTIONS_RELEASED')).toHaveLength(1);
  });

  describe('cancel retries a transient conflict (MariaDB 1020 on the promotion counters)', () => {
    const conflict = () =>
      Object.assign(new Error("Record has changed since last read in table 'promotions'"), {
        errno: 1020,
        code: 'ER_CHECKREAD',
        sqlState: 'HY000',
      });
    /** The next `n` releases of a redemption fail with 1020 (inside the cancel transaction). */
    const failReleases = (n: number) => {
      const query = c.strapi.db.query;
      let calls = 0;
      c.strapi.db.query = (uid: string) => {
        const q = query(uid);
        if (uid !== UIDS.promotionRedemption) return q;
        return {
          ...q,
          updateMany: async (p: any) => {
            calls++;
            if (calls <= n) throw conflict();
            return q.updateMany(p);
          },
        };
      };
      return () => calls;
    };

    it('runs the whole cancel again: released once, restocked once, one event after commit', async () => {
      const id = addPromotion({ method: 'CODE', code: 'VERAO20' });
      const order = await create({ promotionCodes: ['VERAO20'] });
      expect(stockOf(10)).toBe(3);
      c.events.length = 0;
      const calls = failReleases(1);

      await c.orders.cancel(order.id, 'user:2');
      expect(calls()).toBe(2);
      expect(orderRow(order.id).orderStatus).toBe('CANCELLED');
      expect(promotionRow(id).redemptions).toBe(0);
      expect(c.tables[UIDS.promotionRedemption][0].status).toBe('RELEASED');
      expect(stockOf(10)).toBe(5);
      expect(historyOf(order.id, 'PROMOTIONS_RELEASED')).toHaveLength(1);
      expect(historyOf(order.id, 'ORDER_CANCELLED')).toHaveLength(1);
      expect(historyOf(order.id, 'ORDER_STATUS_CHANGED')).toHaveLength(1);
      expect(c.events.filter((e) => e.type === 'ORDER_CANCELLED')).toHaveLength(1);
    });

    it('propagates the conflict after 3 attempts with nothing written and no event', async () => {
      const id = addPromotion({ method: 'CODE', code: 'VERAO20' });
      const order = await create({ promotionCodes: ['VERAO20'] });
      const before = JSON.stringify(c.tables);
      c.events.length = 0;
      const calls = failReleases(3);

      const err: any = await c.orders.cancel(order.id, 'user:2').catch((e) => e);
      expect(err.errno).toBe(1020);
      expect(calls()).toBe(3);
      expect(JSON.stringify(c.tables)).toBe(before);
      expect(promotionRow(id).redemptions).toBe(1);
      expect(c.events).toEqual([]);
    });

    it('does not retry a validation refusal', async () => {
      const order = await create();
      await c.orders.cancel(order.id, 'user:2');
      const calls = failReleases(0);
      expect((await errorsOf(c.orders.cancel(order.id, 'user:2'))).map((e) => e.code)).toEqual([
        'ACTION_NOT_AVAILABLE',
      ]);
      expect(calls()).toBe(0);
    });
  });

  it('3.6 end to end: 150 € of products, 20 € product, 13 € order and 8 € free shipping → 117 €', async () => {
    addVariant(20, 2, 10000, 5, 'Coat');
    addVariant(21, 3, 5000, 5, 'Hat');
    const p1 = addPromotion({
      benefits: {
        items: [{ type: 'PRODUCT_PERCENT', target: T([], [2]), percent: 20, maxQuantity: null }],
      },
    });
    const p2 = addPromotion({ benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] } });
    const p3 = addPromotion({ benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] } });
    setShippingPrice(800);

    const order = await create({
      lines: [
        { variantId: 20, quantity: 1 },
        { variantId: 21, quantity: 1 },
      ],
    });

    expect(orderRow(order.id)).toMatchObject({
      itemsOriginal: 15000,
      productDiscount: 2000,
      subtotal: 13000,
      orderDiscount: 1300,
      shippingOriginal: 800,
      shippingDiscount: 800,
      shippingTotal: 0,
      total: 11700,
    });
    const lines = linesOf(order.id);
    expect(lines.map((l) => [l.variantId, l.quantity, l.unitDiscount])).toEqual([
      [20, 1, 2000],
      [21, 1, 0],
    ]);
    expectTotalsConsistent(order.id);
    expect(
      orderRow(order.id)
        .promotions.applied.map((a: any) => a.promotionId)
        .sort()
    ).toEqual([p1, p2, p3].sort());
    expect(c.tables[UIDS.promotionRedemption]).toHaveLength(3);
    // The history lists every applied promotion.
    expect(historyOf(order.id, 'PROMOTIONS_APPLIED')[0].newValue.promotions).toHaveLength(3);
  });

  it('free shipping above 50 € (design 4.16): 40 € pays shipping, 60 € does not', async () => {
    addPromotion({
      conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 5000 }]),
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });

    const low = await create();
    expect(orderRow(low.id)).toMatchObject({ subtotal: 4000, shippingDiscount: 0, total: 4500 });

    const high = await create({ lines: [{ variantId: 10, quantity: 3 }] });
    expect(orderRow(high.id)).toMatchObject({
      subtotal: 6000,
      shippingOriginal: 500,
      shippingDiscount: 500,
      shippingTotal: 0,
      total: 6000,
    });
    expectTotalsConsistent(high.id);
  });

  it('expectedTotal: wrong → 409 TOTAL_CHANGED with the total; right → created', async () => {
    addPromotion();
    expect(await errorsOf(create({ expectedTotal: 4500 }))).toEqual([
      { path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: '4100' },
    ]);
    expect(c.tables[UIDS.order]).toHaveLength(0);
    const order = await create({ expectedTotal: 4100 });
    expect(orderRow(order.id).total).toBe(4100);
  });

  it('an unknown code → 400 PROMOTION_CODE_INVALID NOT_FOUND; a code in conflict → created without it', async () => {
    expect(await errorsOf(create({ promotionCodes: ['NOPE'] }))).toEqual([
      { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'NOT_FOUND' },
    ]);
    expect(c.tables[UIDS.order]).toHaveLength(0);

    const auto = addPromotion({
      stacking: { ...STACK_ALL, exclusive: true },
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 20 }] },
    });
    const coded = addPromotion({
      method: 'CODE',
      code: 'MENOS1',
      benefits: { items: [{ type: 'ORDER_FIXED', amount: 100 }] },
    });
    const order = await create({ promotionCodes: ['MENOS1'] });
    const stored = orderRow(order.id).promotions;
    expect(stored.applied.map((a: any) => a.promotionId)).toEqual([auto]);
    expect(stored.codes).toEqual([{ code: 'MENOS1', status: 'CONFLICT', promotionId: coded }]);
    expect(promotionRow(coded).redemptions).toBe(0);
  });

  it('a code for an expired promotion → 400 PROMOTION_CODE_INVALID with its status', async () => {
    addPromotion({ method: 'CODE', code: 'OLD', endsAt: '2021-01-01T00:00:00.000Z' });
    expect(await errorsOf(create({ promotionCodes: ['', 'OLD'] }))).toEqual([
      { path: 'promotionCodes.1', code: 'PROMOTION_CODE_INVALID', detail: 'EXPIRED' },
    ]);
  });

  it('rejects more than 5 codes and malformed promotion fields', async () => {
    const errors = await errorsOf(
      create({
        promotionCodes: ['A', 'B', 'C', 'D', 'E', 'F'],
        expectedTotal: -1,
        giftChoices: 'x',
      })
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { path: 'promotionCodes', code: 'too_many' },
        { path: 'expectedTotal', code: 'invalid' },
        { path: 'giftChoices', code: 'invalid' },
      ])
    );
  });

  it('"buy 3, pay 2" creates two lines of the same variant; a modification by orderLineId still works', async () => {
    addPromotion({
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'IN_CART', target: T([10]), quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const order = await create({ lines: [{ variantId: 10, quantity: 3 }] });
    const lines = linesOf(order.id);
    expect(lines.map((l) => [l.variantId, l.quantity, l.unitDiscount, l.isGift])).toEqual([
      [10, 2, 0, false],
      [10, 1, 2000, false],
    ]);
    expect(orderRow(order.id)).toMatchObject({ subtotal: 4000, total: 4500 });
    const deducts = c.tables[UIDS.stockMovement].filter((m) => m.type === 'ORDER_DEDUCT');
    expect(deducts.map((m) => m.quantity)).toEqual([-3]);

    const res = await c.orders.applyModification(
      order.id,
      {
        lines: [
          { orderLineId: lines[0].id, variantId: 10, quantity: 3 },
          { orderLineId: lines[1].id, variantId: 10, quantity: 1 },
        ],
        shipping: { mode: 'KEEP' },
      },
      'user:1',
      'op-mod-0001'
    );
    expect(res.order.lines.map((l: any) => [l.quantity, l.unitDiscount])).toEqual([
      [3, 0],
      [1, 2000],
    ]);
    expect(res.order.totals.total).toBe(6500);
    expect(stockOf(10)).toBe(1);
  });

  it('an order without promotions is unchanged (plan 3) and get() never reads redemptions', async () => {
    const statuses = vi.spyOn(promoSvc, 'redemptionStatuses');
    const order = await create();
    expect(orderRow(order.id)).toMatchObject({
      itemsOriginal: 4000,
      productDiscount: 0,
      subtotal: 4000,
      orderDiscount: 0,
      shippingOriginal: 500,
      shippingDiscount: 0,
      total: 4500,
      promotions: { applied: [], codes: [], exhaustive: true },
    });
    expect(linesOf(order.id)).toEqual([
      expect.objectContaining({
        variantId: 10,
        quantity: 2,
        unitDiscount: 0,
        isGift: false,
        promotionRefs: { refs: [] },
      }),
    ]);
    expect(
      c.tables[UIDS.orderHistory].filter((h) => String(h.type).startsWith('PROMOTIONS_'))
    ).toEqual([]);
    const view = await c.orders.get(order.id);
    expect(view.promotions).toEqual([]);
    expect(view.lines[0].promotionIds).toEqual([]);
    expect(statuses).not.toHaveBeenCalled();

    await c.orders.cancel(order.id, 'user:1');
    expect(historyOf(order.id, 'PROMOTIONS_RELEASED')).toEqual([]);
  });

  it('get() reads a legacy order with promotions [] and promotionRefs [] as empty', async () => {
    const order = await create();
    orderRow(order.id).promotions = [];
    linesOf(order.id)[0].promotionRefs = [];
    const view = await c.orders.get(order.id);
    expect(view.promotions).toEqual([]);
    expect(view.promotionCodes).toEqual([]);
    expect(view.lines[0].promotionIds).toEqual([]);
  });

  it('get() keeps only well-formed stored code entries', async () => {
    const order = await create();
    orderRow(order.id).promotions = {
      applied: [],
      codes: [{ code: 'OK1', status: 'NOT_FOUND', promotionId: null }, null, { status: 'APPLIED' }, 'X'],
      exhaustive: true,
    };
    expect((await c.orders.get(order.id)).promotionCodes).toEqual([
      { code: 'OK1', status: 'NOT_FOUND', promotionId: null },
    ]);
  });
});

describe('orders with promotions: review fixes', () => {
  const giftPromotion = () =>
    addPromotion({
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 1, minAmount: null },
            get: { mode: 'GIFT', variantIds: [30], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });

  it('gifts that change once shipping is known are quoted again; the third evaluation is final', async () => {
    addVariant(30, 4, 300, 5, 'Socks');
    giftPromotion();
    const ship = addPromotion({
      stacking: { ...STACK_ALL, exclusive: true },
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });
    const findOption = setShippingPrice(1000);

    const order = await create({ lines: [{ variantId: 10, quantity: 1 }] });

    expect(findOption).toHaveBeenCalledTimes(2);
    const items = (i: number) =>
      findOption.mock.calls[i][0].items.map((x: any) => [x.variantId, x.quantity]);
    expect(items(0)).toEqual([
      [10, 1],
      [30, 1],
    ]);
    expect(items(1)).toEqual([[10, 1]]);
    expect(linesOf(order.id).map((l) => [l.variantId, l.isGift])).toEqual([[10, false]]);
    expect(orderRow(order.id)).toMatchObject({ shippingDiscount: 1000, total: 2000 });
    expect(orderRow(order.id).promotions.applied.map((a: any) => a.promotionId)).toEqual([ship]);
    expect(c.tables[UIDS.stockMovement].map((m) => [m.variantId, m.quantity])).toEqual([[10, -1]]);
    expectTotalsConsistent(order.id);
  });

  it('NO_BENEFIT code → created without it', async () => {
    addVariant(20, 2, 10000, 5, 'Coat');
    const id = addPromotion({
      method: 'CODE',
      code: 'COAT',
      benefits: {
        items: [{ type: 'PRODUCT_PERCENT', target: T([20]), percent: 10, maxQuantity: null }],
      },
    });
    const order = await create({ promotionCodes: ['COAT'] });
    expect(orderRow(order.id).promotions.codes).toEqual([
      { code: 'COAT', status: 'NO_BENEFIT', promotionId: id },
    ]);
    expect(orderRow(order.id).promotions.applied).toEqual([]);
    expect(c.tables[UIDS.promotionRedemption]).toEqual([]);
    // The admin view lists the entered code with its status, though it did not apply.
    expect((await c.orders.get(order.id)).promotionCodes).toEqual([
      { code: 'COAT', status: 'NO_BENEFIT', promotionId: id },
    ]);
  });

  it('CUSTOMER_LIMIT_REACHED code → 409 PROMOTION_UNAVAILABLE', async () => {
    const id = addPromotion({ method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
    c.tables[UIDS.promotionCustomerUsage].push({
      id: 1,
      promotion: id,
      emailNormalized: 'ana@example.pt',
      uses: 1,
      uniqueKey: usageKey(id, 'ana@example.pt'),
    });
    expect(await errorsOf(create({ promotionCodes: ['ONCE'] }))).toEqual([
      { path: `promotions.${id}`, code: 'PROMOTION_UNAVAILABLE', detail: 'ONCE' },
    ]);
    expect(c.tables[UIDS.order]).toHaveLength(0);
  });

  it('EMAIL_NOT_ELIGIBLE code → 400 PROMOTION_CODE_INVALID', async () => {
    addPromotion({
      method: 'CODE',
      code: 'VIP',
      eligibility: { mode: 'EMAILS', emails: ['bob@example.pt'] },
    });
    expect(await errorsOf(create({ promotionCodes: ['VIP'] }))).toEqual([
      { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'EMAIL_NOT_ELIGIBLE' },
    ]);
  });

  it('an entered code the evaluation does not report is NOT_FOUND', async () => {
    const real = promoSvc.evaluate;
    vi.spyOn(promoSvc, 'evaluate').mockImplementation((input: any) => ({
      ...real(input),
      codes: [],
    }));
    expect(await errorsOf(create({ promotionCodes: ['GHOST'] }))).toEqual([
      { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'NOT_FOUND' },
    ]);
  });

  it('evaluatedAt is the time of the evaluation, not of the write', async () => {
    addPromotion();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-11T10:00:00.000Z'));
      c.services.EcommerceShippingService = {
        findOption: async (_req: any, providerId: string, serviceId: string) => {
          vi.setSystemTime(new Date('2026-11-11T10:05:00.000Z'));
          return { providerId, serviceId, name: 'Standard', price: 500, tax: 23 };
        },
      };
      const order = await create();
      expect(orderRow(order.id).promotions.evaluatedAt).toBe('2026-11-11T10:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaying a create with promotions keeps one order and one redemption', async () => {
    const id = addPromotion({ method: 'CODE', code: 'VERAO20' });
    const first = await create({ promotionCodes: ['VERAO20'], idempotencyKey: 'key-promo-1' });
    const again = await create({ promotionCodes: ['VERAO20'], idempotencyKey: 'key-promo-1' });
    expect(again.id).toBe(first.id);
    expect(c.tables[UIDS.order]).toHaveLength(1);
    expect(promotionRow(id).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionRedemption]).toHaveLength(1);
    expect(historyOf(first.id, 'PROMOTIONS_APPLIED')).toHaveLength(1);
  });
});

describe('orders with promotions: quote', () => {
  it('without shipping: shippingOriginal null, shipping-only promotions AWAITING_SHIPPING, nothing written', async () => {
    const order = addPromotion();
    const ship = addPromotion({
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });
    const before = JSON.stringify(c.tables);

    const q = await c.orders.quote({ lines: [{ variantId: 10, quantity: 2 }], locale: 'en' });

    expect(q.totals).toEqual({
      itemsOriginal: 4000,
      productDiscount: 0,
      subtotal: 4000,
      orderDiscount: 400,
      shippingOriginal: null,
      shippingDiscount: 0,
      shippingTotal: null,
      total: 3600,
      totalDiscount: 400,
    });
    expect(q.shippingOption).toBeNull();
    expect(q.promotions.map((p: any) => p.promotionId)).toEqual([order]);
    expect(q.rejected).toEqual([{ promotionId: ship, reason: 'AWAITING_SHIPPING' }]);
    expect(q.lines).toEqual([
      expect.objectContaining({
        variantId: 10,
        quantity: 2,
        sku: 'SH-M',
        name: 'Shirt',
        option: null,
        imageUrl: null,
      }),
    ]);
    expect(q.exhaustive).toBe(true);
    expect(JSON.stringify(c.tables)).toBe(before);
  });

  it('with shipping: the shipping promotion applies and the option is returned', async () => {
    addPromotion({ benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] } });
    setShippingPrice(700);
    const q = await c.orders.quote({
      lines: [{ variantId: 10, quantity: 1 }],
      locale: 'en',
      email: 'ana@example.pt',
      promotionCodes: ['nope'],
      shipping: { country: 'PT', postalCode: '1000-001', providerId: 'manual', serviceId: '1' },
    });
    expect(q.totals).toMatchObject({
      shippingOriginal: 700,
      shippingDiscount: 700,
      shippingTotal: 0,
      total: 2000,
    });
    expect(q.shippingOption).toMatchObject({ providerId: 'manual', serviceId: '1', price: 700 });
    expect(q.codes).toEqual([{ code: 'NOPE', status: 'NOT_FOUND', promotionId: null }]);
  });

  it('the same line errors as create', async () => {
    expect(
      (
        await errorsOf(c.orders.quote({ lines: [{ variantId: 10, quantity: 9 }], locale: 'en' }))
      ).map((e) => e.code)
    ).toEqual(['INSUFFICIENT_STOCK']);
    expect(
      (
        await errorsOf(c.orders.quote({ lines: [{ variantId: 99, quantity: 1 }], locale: 'en' }))
      ).map((e) => e.code)
    ).toEqual(['VARIANT_UNAVAILABLE']);
    c.services.EcommerceShippingService = { findOption: async () => null };
    expect(
      (
        await errorsOf(
          c.orders.quote({
            lines: [{ variantId: 10, quantity: 1 }],
            locale: 'en',
            shipping: { country: 'PT', providerId: 'manual', serviceId: '1' },
          })
        )
      ).map((e) => e.code)
    ).toEqual(['SHIPPING_UNAVAILABLE']);
  });

  it('a gift of another variant goes to the carrier; one quote when the gifts do not change', async () => {
    addVariant(30, 4, 300, 5, 'Socks');
    addPromotion({
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 1, minAmount: null },
            get: { mode: 'GIFT', variantIds: [30], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const findOption = setShippingPrice(500);
    const q = await c.orders.quote({
      lines: [{ variantId: 10, quantity: 1 }],
      locale: 'en',
      shipping: { country: 'PT', providerId: 'manual', serviceId: '1' },
    });
    expect(findOption).toHaveBeenCalledTimes(1);
    expect(findOption.mock.calls[0][0].items.map((i: any) => [i.variantId, i.quantity])).toEqual([
      [10, 1],
      [30, 1],
    ]);
    expect(q.lines.find((l: any) => l.isGift)).toMatchObject({
      variantId: 30,
      name: 'Socks',
      unitDiscount: 300,
    });
  });
});
