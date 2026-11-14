import { describe, it, expect, vi } from 'vitest';
import {
  simulateModification,
  type ExistingLine,
  type CatalogVariant,
  type ModificationInput,
} from '../../../../server/src/services/modules/ecommerce/domain/orderModification';
import type { PaymentLike } from '../../../../server/src/services/modules/ecommerce/domain/orders';
import type { AppliedPromotion } from '../../../../server/src/services/modules/ecommerce/domain/promotions';

const existing = (over: Partial<ExistingLine> = {}): ExistingLine => ({
  id: 1,
  variantId: 101,
  productId: 1,
  sku: 'SKU-101',
  name: 'Mug',
  option: 'Blue',
  tax: 23,
  unitPrice: 3000,
  unitDiscount: 0,
  quantity: 1,
  returnedQuantity: 0,
  shipped: 0,
  isGift: false,
  ...over,
});

const variant = (over: Partial<CatalogVariant> = {}): CatalogVariant => ({
  variantId: 201,
  productId: 2,
  sku: 'SKU-201',
  name: 'Plate',
  option: '',
  unitPrice: 2500,
  tax: 23,
  imageUrl: null,
  stock: 10,
  active: true,
  ...over,
});

const catalogOf = (...vs: CatalogVariant[]) => new Map(vs.map((v) => [v.variantId, v]));

const paid = (amount: number): PaymentLike[] => [{ status: 'COMPLETED', amount }];

const keep: ModificationInput['shipping'] = { mode: 'KEEP' };

describe('simulateModification', () => {
  it('RECALCULATE: shipping 1000, shipments 600, quote 800 → 1400, difference +400 (req 16.5.2)', () => {
    const current = {
      lines: [existing({ id: 1, unitPrice: 9000, quantity: 1 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: paid(10000),
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }],
        shipping: { mode: 'RECALCULATE', quote: 800, previousShipmentsCost: 600 },
      },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.shipping).toMatchObject({
      mode: 'RECALCULATE',
      previousCharged: 1000,
      newCharged: 1400,
      previousShipmentsCost: 600,
      quote: 800,
      shippingOriginal: 1400,
      shippingDiscount: 0,
    });
    expect(r.after.shippingTotal).toBe(1400);
    expect(r.difference).toBe(400);
    expect(r.outcome).toBe('DUE');
    expect(r.after.due).toBe(400);
  });

  it('RECALCULATE drops the shipping discount (free shipping no longer applies)', () => {
    const r = simulateModification(
      {
        lines: [existing()],
        orderDiscount: 0,
        shippingOriginal: 500,
        shippingDiscount: 500,
        payments: [],
        refunds: [],
      },
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: { mode: 'RECALCULATE', quote: 700, previousShipmentsCost: 0 } },
      catalogOf(),
    );
    expect(r.shipping.previousCharged).toBe(0);
    expect(r.shipping.newCharged).toBe(700);
    expect(r.after.shippingTotal).toBe(700);
  });

  it('adds a 2500 product and +400 shipping to a paid 10000 order → due 2900, DUE (req 16.7)', () => {
    const current = {
      lines: [existing({ id: 1, unitPrice: 9000, quantity: 1 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: paid(10000),
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 1 },
          { variantId: 201, quantity: 1 },
        ],
        shipping: { mode: 'RECALCULATE', quote: 800, previousShipmentsCost: 600 },
      },
      catalogOf(variant({ variantId: 201, unitPrice: 2500 })),
    );
    expect(r.errors).toEqual([]);
    expect(r.before).toMatchObject({ total: 10000, paid: 10000, due: 0, excess: 0 });
    expect(r.after).toMatchObject({ subtotal: 11500, total: 12900, paid: 10000, due: 2900, excess: 0 });
    expect(r.outcome).toBe('DUE');
    expect(r.difference).toBe(2900);
    expect(r.lineChanges).toContainEqual({
      kind: 'ADDED',
      variantId: 201,
      previousQuantity: 0,
      newQuantity: 1,
    });
    expect(r.stockMovements).toEqual([{ variantId: 201, quantity: -1 }]);
  });

  it('removes a 3000 product from a paid 10000 order → REFUNDABLE 3000 (req 16.9)', () => {
    const current = {
      lines: [
        existing({ id: 1, variantId: 101, unitPrice: 6000, quantity: 1 }),
        existing({ id: 2, variantId: 102, unitPrice: 3000, quantity: 1 }),
      ],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: paid(10000),
      refunds: [],
    };
    const r = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.after.total).toBe(7000);
    expect(r.after.excess).toBe(3000);
    expect(r.outcome).toBe('REFUNDABLE');
    expect(r.difference).toBe(-3000);
    expect(r.lineChanges).toContainEqual({
      kind: 'REMOVED',
      orderLineId: 2,
      variantId: 102,
      previousQuantity: 1,
      newQuantity: 0,
    });
    expect(r.stockMovements).toEqual([{ variantId: 102, quantity: 1 }]);
  });

  it('removing every line → LINES_REQUIRED', () => {
    const current = {
      lines: [existing({ id: 1, variantId: 101 }), existing({ id: 2, variantId: 102 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const omitted = simulateModification(current, { lines: [], shipping: keep }, catalogOf());
    expect(omitted.errors).toEqual([{ path: 'lines', code: 'LINES_REQUIRED' }]);
    const zeroed = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 0 },
          { orderLineId: 2, variantId: 102, quantity: 0 },
          { variantId: 201, quantity: 0 },
        ],
        shipping: keep,
      },
      catalogOf(variant()),
    );
    expect(zeroed.errors).toEqual([{ path: 'lines', code: 'LINES_REQUIRED' }]);
    // Replacing every line with a new one is fine.
    const replaced = simulateModification(
      current,
      { lines: [{ variantId: 201, quantity: 1 }], shipping: keep },
      catalogOf(variant()),
    );
    expect(replaced.errors).toEqual([]);
  });

  it('Review Focus 1: reducing a quantity below what was shipped → QUANTITY_BELOW_SHIPPED', () => {
    const current = {
      lines: [existing({ id: 7, quantity: 10, shipped: 4 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const bad = simulateModification(
      current,
      { lines: [{ orderLineId: 7, variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(),
    );
    expect(bad.errors).toEqual([{ path: 'lines.0.quantity', code: 'QUANTITY_BELOW_SHIPPED' }]);

    const ok = simulateModification(
      current,
      { lines: [{ orderLineId: 7, variantId: 101, quantity: 4 }], shipping: keep },
      catalogOf(),
    );
    expect(ok.errors).toEqual([]);

    const removed = simulateModification(current, { lines: [], shipping: keep }, catalogOf());
    expect(removed.errors).toEqual([{ path: 'removed.7', code: 'QUANTITY_BELOW_SHIPPED' }]);
  });

  it('insufficient stock for an increase → INSUFFICIENT_STOCK', () => {
    const current = {
      lines: [existing({ id: 1, variantId: 101, quantity: 2 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const catalog = catalogOf(variant({ variantId: 101, stock: 2 }), variant({ variantId: 201, stock: 0 }));
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 5 },
          { variantId: 201, quantity: 1 },
        ],
        shipping: keep,
      },
      catalog,
    );
    expect(r.errors).toEqual([
      { path: 'lines.0.quantity', code: 'INSUFFICIENT_STOCK' },
      { path: 'lines.1.quantity', code: 'INSUFFICIENT_STOCK' },
    ]);

    const ok = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 4 }], shipping: keep },
      catalog,
    );
    expect(ok.errors).toEqual([]);
  });

  it('stock movements: 2→5 gives -3 and 5→3 gives +2', () => {
    const current = {
      lines: [
        existing({ id: 1, variantId: 101, quantity: 2 }),
        existing({ id: 2, variantId: 102, quantity: 5 }),
      ],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 5 },
          { orderLineId: 2, variantId: 102, quantity: 3 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 101, stock: 10 }), variant({ variantId: 102, stock: 0 })),
    );
    expect(r.errors).toEqual([]);
    expect(r.stockMovements).toEqual([
      { variantId: 101, quantity: -3 },
      { variantId: 102, quantity: 2 },
    ]);
    expect(r.lineChanges).toEqual([
      { kind: 'QUANTITY_CHANGED', orderLineId: 1, variantId: 101, previousQuantity: 2, newQuantity: 5 },
      { kind: 'QUANTITY_CHANGED', orderLineId: 2, variantId: 102, previousQuantity: 5, newQuantity: 3 },
    ]);
  });

  it('KEEP with no line changes → NONE, difference 0', () => {
    const current = {
      lines: [existing({ id: 1, unitPrice: 9000 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 200,
      payments: paid(9800),
      refunds: [],
    };
    const r = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.outcome).toBe('NONE');
    expect(r.difference).toBe(0);
    expect(r.stockMovements).toEqual([]);
    expect(r.lineChanges).toEqual([
      { kind: 'UNCHANGED', orderLineId: 1, variantId: 101, previousQuantity: 1, newQuantity: 1 },
    ]);
    expect(r.shipping).toMatchObject({
      mode: 'KEEP',
      previousCharged: 800,
      newCharged: 800,
      shippingOriginal: 1000,
      shippingDiscount: 200,
    });
  });

  it('existing lines keep unitPrice/unitDiscount; new lines use catalog price with no discount', () => {
    const current = {
      lines: [existing({ id: 1, variantId: 101, unitPrice: 3000, unitDiscount: 500, quantity: 2 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 1 },
          { variantId: 201, quantity: 2 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 101, unitPrice: 9999 }), variant({ variantId: 201, unitPrice: 1000 })),
    );
    // 1 × (3000 − 500) + 2 × 1000
    expect(r.after).toMatchObject({ itemsOriginal: 5000, productDiscount: 500, subtotal: 4500 });
  });

  it('a new line with a variantId already present as a non-gift line is a quantity change', () => {
    const current = {
      lines: [existing({ id: 1, variantId: 101, quantity: 2 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      { lines: [{ variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(variant({ variantId: 101, stock: 5 })),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges).toEqual([
      { kind: 'QUANTITY_CHANGED', orderLineId: 1, variantId: 101, previousQuantity: 2, newQuantity: 3 },
    ]);
    expect(r.stockMovements).toEqual([{ variantId: 101, quantity: -1 }]);
  });

  it('new line with an inactive or missing variant → VARIANT_UNAVAILABLE', () => {
    const current = { lines: [], orderDiscount: 0, shippingOriginal: 0, shippingDiscount: 0, payments: [], refunds: [] };
    const r = simulateModification(
      current,
      {
        lines: [
          { variantId: 201, quantity: 1 },
          { variantId: 999, quantity: 1 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 201, active: false })),
    );
    expect(r.errors).toEqual([
      { path: 'lines.0.quantity', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.1.quantity', code: 'VARIANT_UNAVAILABLE' },
    ]);
  });

  it('invalid quantities → INVALID_QUANTITY', () => {
    const current = {
      lines: [existing({ id: 1 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: -1 },
          { variantId: 201, quantity: 1.5 },
        ],
        shipping: keep,
      },
      catalogOf(variant()),
    );
    expect(r.errors).toEqual([
      { path: 'lines.0.quantity', code: 'INVALID_QUANTITY' },
      { path: 'lines.1.quantity', code: 'INVALID_QUANTITY' },
    ]);
  });

  it('gift lines cannot change; omitted gift lines are kept unchanged', () => {
    const current = {
      lines: [
        existing({ id: 1, variantId: 101, quantity: 1 }),
        existing({ id: 2, variantId: 301, quantity: 1, unitPrice: 1000, unitDiscount: 1000, isGift: true }),
      ],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const changed = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 1 },
          { orderLineId: 2, variantId: 301, quantity: 2 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 301 })),
    );
    expect(changed.errors).toEqual([{ path: 'lines.1.quantity', code: 'INVALID_QUANTITY' }]);

    const omitted = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(omitted.errors).toEqual([]);
    expect(omitted.lineChanges).toContainEqual({
      kind: 'UNCHANGED',
      orderLineId: 2,
      variantId: 301,
      previousQuantity: 1,
      newQuantity: 1,
    });
    expect(omitted.stockMovements).toEqual([]);
  });

  it('MANUAL shipping: amount ≥ 0 integer, discount cleared; invalid → INVALID_AMOUNT', () => {
    const current = {
      lines: [existing({ id: 1 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 1000,
      payments: [],
      refunds: [],
    };
    const lines = [{ orderLineId: 1, variantId: 101, quantity: 1 }];
    const ok = simulateModification(current, { lines, shipping: { mode: 'MANUAL', amount: 0 } }, catalogOf());
    expect(ok.errors).toEqual([]);
    expect(ok.shipping).toMatchObject({ mode: 'MANUAL', previousCharged: 0, newCharged: 0, shippingOriginal: 0, shippingDiscount: 0 });

    const set = simulateModification(current, { lines, shipping: { mode: 'MANUAL', amount: 450 } }, catalogOf());
    expect(set.after.shippingTotal).toBe(450);

    const max = simulateModification(current, { lines, shipping: { mode: 'MANUAL', amount: 1_000_000_000 } }, catalogOf());
    expect(max.errors).toEqual([]);

    for (const amount of [-1, 1.5, Number.NaN, 1_000_000_001]) {
      const bad = simulateModification(current, { lines, shipping: { mode: 'MANUAL', amount } }, catalogOf());
      expect(bad.errors).toEqual([{ path: 'shipping.amount', code: 'INVALID_AMOUNT' }]);
    }
  });

  it('order discount keeps its value, capped at the new subtotal with a warning', () => {
    const current = {
      lines: [
        existing({ id: 1, variantId: 101, unitPrice: 3000, quantity: 1 }),
        existing({ id: 2, variantId: 102, unitPrice: 1000, quantity: 1 }),
      ],
      orderDiscount: 2000,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const kept = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(kept.after.orderDiscount).toBe(2000);
    expect(kept.discountWarnings).toEqual([]);

    const capped = simulateModification(
      current,
      { lines: [{ orderLineId: 2, variantId: 102, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(capped.after.orderDiscount).toBe(1000);
    expect(capped.after.total).toBe(0);
    expect(capped.discountWarnings).toEqual([{ code: 'ORDER_DISCOUNT_CAPPED' }]);
  });

  it('unknown orderLineId or the same line referenced twice → INVALID_QUANTITY', () => {
    const current = {
      lines: [existing({ id: 1, variantId: 101, quantity: 2 })],
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 2 },
          { variantId: 101, quantity: 3 },
          { orderLineId: 99, variantId: 101, quantity: 1 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 101 })),
    );
    expect(r.errors).toEqual([
      { path: 'lines.1.quantity', code: 'INVALID_QUANTITY' },
      { path: 'lines.2.quantity', code: 'INVALID_QUANTITY' },
    ]);
    expect(r.lineChanges).toHaveLength(1);
  });
  it('no ORDER_DISCOUNT_CAPPED when a line has returns but the discount still fits', () => {
    const current = {
      lines: [existing({ id: 1, unitPrice: 5000, unitDiscount: 1000, quantity: 2, returnedQuantity: 1, shipped: 2 })],
      orderDiscount: 650,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 2 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.after.orderDiscount).toBe(650);
    expect(r.discountWarnings).toEqual([]);
  });

  it('order discount keeps its euro value with returns when a line is added (difference = new line)', () => {
    const current = {
      lines: [existing({ id: 1, unitPrice: 5000, unitDiscount: 1000, quantity: 2, returnedQuantity: 1, shipped: 2 })],
      orderDiscount: 650,
      shippingOriginal: 0,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const r = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 2 },
          { variantId: 201, quantity: 1 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 201, unitPrice: 5000 })),
    );
    expect(r.errors).toEqual([]);
    expect(r.before.orderDiscount).toBe(650);
    expect(r.after.orderDiscount).toBe(650);
    expect(r.difference).toBe(5000);
  });

  it('RECALCULATE validates quote and previousShipmentsCost → INVALID_AMOUNT', () => {
    const current = {
      lines: [existing({ id: 1 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const lines = [{ orderLineId: 1, variantId: 101, quantity: 1 }];
    const r = simulateModification(
      current,
      { lines, shipping: { mode: 'RECALCULATE', quote: -1, previousShipmentsCost: 1.5 } },
      catalogOf(),
    );
    expect(r.errors).toEqual([
      { path: 'shipping.quote', code: 'INVALID_AMOUNT' },
      { path: 'shipping.previousShipmentsCost', code: 'INVALID_AMOUNT' },
    ]);
    expect(r.shipping.newCharged).toBe(1000);
    expect(r.after.shippingTotal).toBe(1000);
  });

  it('RECALCULATE rejects quote and previousShipmentsCost above 1_000_000_000 cents', () => {
    const current = {
      lines: [existing({ id: 1 })],
      orderDiscount: 0,
      shippingOriginal: 1000,
      shippingDiscount: 0,
      payments: [],
      refunds: [],
    };
    const lines = [{ orderLineId: 1, variantId: 101, quantity: 1 }];
    const r = simulateModification(
      current,
      { lines, shipping: { mode: 'RECALCULATE', quote: 1_000_000_001, previousShipmentsCost: 1_000_000_001 } },
      catalogOf(),
    );
    expect(r.errors).toEqual([
      { path: 'shipping.quote', code: 'INVALID_AMOUNT' },
      { path: 'shipping.previousShipmentsCost', code: 'INVALID_AMOUNT' },
    ]);
    const ok = simulateModification(
      current,
      { lines, shipping: { mode: 'RECALCULATE', quote: 1_000_000_000, previousShipmentsCost: 0 } },
      catalogOf(),
    );
    expect(ok.errors).toEqual([]);
  });
});

/** An applied promotion as the order stored it (Task 7 snapshot). */
const appliedPromotion = (over: Partial<AppliedPromotion> = {}): AppliedPromotion => ({
  promotionId: 7,
  version: 1,
  name: '10% above 100 €',
  displayName: {},
  code: null,
  method: 'AUTOMATIC',
  classes: ['ORDER_DISCOUNT'],
  amount: 1200,
  benefits: [
    {
      index: 0,
      type: 'ORDER_PERCENT',
      class: 'ORDER_DISCOUNT',
      amount: 1200,
      params: { type: 'ORDER_PERCENT', percent: 10 } as any,
    },
  ],
  snapshot: {
    eligibility: { mode: 'ALL' },
    conditions: {
      type: 'GROUP',
      operator: 'AND',
      children: [{ type: 'SUBTOTAL', operator: 'gte', value: 10000 }],
    },
    stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
    priority: 0,
    perOrderLimit: null,
  },
  ...over,
});

const freeShipping = (over: Partial<AppliedPromotion> = {}): AppliedPromotion =>
  appliedPromotion({
    promotionId: 8,
    name: 'Free shipping',
    classes: ['SHIPPING_DISCOUNT'],
    amount: 500,
    benefits: [
      {
        index: 0,
        type: 'SHIPPING_FREE',
        class: 'SHIPPING_DISCOUNT',
        amount: 500,
        params: { type: 'SHIPPING_FREE', maxAmount: null } as any,
      },
    ],
    snapshot: { ...appliedPromotion().snapshot, conditions: { type: 'GROUP', operator: 'AND', children: [] } },
    ...over,
  });

describe('simulateModification: promotions and the order discount (design 4.8)', () => {
  /** 3 × 4000 = 12000 with "10% above 100 €" applied (1200 off). */
  const promoCurrent = (over: Record<string, unknown> = {}) => ({
    lines: [existing({ id: 1, unitPrice: 4000, quantity: 3 })],
    orderDiscount: 1200,
    shippingOriginal: 500,
    shippingDiscount: 0,
    payments: [],
    refunds: [],
    promotions: [appliedPromotion()],
    email: 'ana@example.pt',
    ...over,
  });

  it('the order drops to 80 €: PROMOTION_CONDITION_UNMET with id and name, the discount is kept', () => {
    const r = simulateModification(
      promoCurrent(),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 2 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.discountWarnings).toEqual([
      { code: 'PROMOTION_CONDITION_UNMET', promotionId: 7, name: '10% above 100 €' },
    ]);
    expect(r.after).toMatchObject({ subtotal: 8000, orderDiscount: 1200, total: 7300 });
  });

  it('conditions still met → no warning', () => {
    const r = simulateModification(
      promoCurrent(),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }, { variantId: 201, quantity: 1 }], shipping: keep },
      catalogOf(variant()),
    );
    expect(r.discountWarnings).toEqual([]);
  });

  it('evaluates the non-gift lines after the modification at original price, net of returns, with the e-mail', () => {
    const unmet = vi.fn(() => []);
    simulateModification(
      promoCurrent({
        lines: [
          existing({ id: 1, unitPrice: 4000, unitDiscount: 400, quantity: 3, returnedQuantity: 1 }),
          existing({ id: 2, variantId: 102, productId: 5, unitPrice: 900, unitDiscount: 900, quantity: 1, isGift: true }),
          existing({ id: 3, variantId: 103, unitPrice: 100, quantity: 1 }),
        ],
      }),
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 3 },
          { orderLineId: 2, variantId: 102, quantity: 1 },
          { variantId: 201, quantity: 2 },
        ],
        shipping: keep,
      },
      catalogOf(variant()),
      { unmet },
    );
    expect(unmet).toHaveBeenCalledTimes(1);
    expect(unmet).toHaveBeenCalledWith([appliedPromotion()], {
      lines: [
        { variantId: 101, productId: 1, unitPrice: 4000, quantity: 2 },
        { variantId: 201, productId: 2, unitPrice: 2500, quantity: 2 },
      ],
      email: 'ana@example.pt',
    });
  });

  it('a fixture without promotions or e-mail works and never warns about promotions', () => {
    const r = simulateModification(
      {
        lines: [existing({ id: 1, unitPrice: 4000, quantity: 3 })],
        orderDiscount: 0,
        shippingOriginal: 500,
        shippingDiscount: 0,
        payments: [],
        refunds: [],
      },
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.discountWarnings).toEqual([]);
  });

  it('an e-mail-restricted promotion is unmet when the order has no e-mail', () => {
    const p = appliedPromotion({
      snapshot: {
        ...appliedPromotion().snapshot,
        eligibility: { mode: 'EMAILS', emails: ['ana@example.pt'] },
        conditions: { type: 'GROUP', operator: 'AND', children: [] },
      },
    });
    const withEmail = simulateModification(
      promoCurrent({ promotions: [p] }),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(),
    );
    expect(withEmail.discountWarnings).toEqual([]);
    const withoutEmail = simulateModification(
      promoCurrent({ promotions: [p], email: undefined }),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(),
    );
    expect(withoutEmail.discountWarnings).toEqual([
      { code: 'PROMOTION_CONDITION_UNMET', promotionId: 7, name: '10% above 100 €' },
    ]);
  });

  it('a malformed stored snapshot fails closed: reported as unmet', () => {
    const broken = { ...appliedPromotion(), snapshot: null } as unknown as AppliedPromotion;
    const r = simulateModification(
      promoCurrent({ promotions: [broken] }),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.discountWarnings).toEqual([
      { code: 'PROMOTION_CONDITION_UNMET', promotionId: 7, name: '10% above 100 €' },
    ]);
  });

  it('orderDiscount: 0 replaces the stored 1300: total rises, no capped warning', () => {
    const r = simulateModification(
      promoCurrent({ orderDiscount: 1300, promotions: [] }),
      {
        lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }],
        shipping: keep,
        orderDiscount: 0,
      },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.before.orderDiscount).toBe(1300);
    expect(r.after).toMatchObject({ subtotal: 12000, orderDiscount: 0, total: 12500 });
    expect(r.difference).toBe(1300);
    expect(r.discountWarnings).toEqual([]);
  });

  it('a manual orderDiscount above the new subtotal is capped and warned against the requested value', () => {
    const r = simulateModification(
      promoCurrent({ orderDiscount: 0, promotions: [] }),
      {
        lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }],
        shipping: keep,
        orderDiscount: 5000,
      },
      catalogOf(),
    );
    expect(r.after.orderDiscount).toBe(4000);
    expect(r.discountWarnings).toEqual([{ code: 'ORDER_DISCOUNT_CAPPED' }]);
  });

  it('without orderDiscount, a subtotal below the stored discount still warns ORDER_DISCOUNT_CAPPED', () => {
    const r = simulateModification(
      promoCurrent({ orderDiscount: 5000, promotions: [] }),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalogOf(),
    );
    expect(r.after.orderDiscount).toBe(4000);
    expect(r.discountWarnings).toEqual([{ code: 'ORDER_DISCOUNT_CAPPED' }]);
  });

  it.each([-1, 1.5, 1_000_000_001, '100', null])('orderDiscount %s → INVALID_AMOUNT', (value) => {
    const r = simulateModification(
      promoCurrent({ promotions: [] }),
      {
        lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }],
        shipping: keep,
        orderDiscount: value as any,
      },
      catalogOf(),
    );
    expect(r.errors).toEqual([{ path: 'orderDiscount', code: 'INVALID_AMOUNT' }]);
  });

  it.each([
    ['RECALCULATE', { mode: 'RECALCULATE', quote: 700, previousShipmentsCost: 0 }],
    ['MANUAL', { mode: 'MANUAL', amount: 300 }],
  ] as const)('%s shipping drops an applied free-shipping promotion: SHIPPING_PROMOTION_DROPPED', (_m, shipping) => {
    const current = promoCurrent({
      shippingOriginal: 500,
      shippingDiscount: 500,
      promotions: [appliedPromotion(), freeShipping()],
    });
    const r = simulateModification(
      current,
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }], shipping: shipping as any },
      catalogOf(),
    );
    expect(r.errors).toEqual([]);
    expect(r.shipping.shippingDiscount).toBe(0);
    expect(r.discountWarnings).toEqual([
      { code: 'SHIPPING_PROMOTION_DROPPED', promotionId: 8, name: 'Free shipping' },
    ]);
    // The stored promotions are not touched.
    expect(current.promotions).toEqual([appliedPromotion(), freeShipping()]);
  });

  it('KEEP shipping, or a shipping discount already gone, does not warn about shipping promotions', () => {
    const lines = [{ orderLineId: 1, variantId: 101, quantity: 3 }];
    const kept = simulateModification(
      promoCurrent({ shippingDiscount: 500, promotions: [freeShipping()] }),
      { lines, shipping: keep },
      catalogOf(),
    );
    expect(kept.discountWarnings).toEqual([]);
    const gone = simulateModification(
      promoCurrent({ shippingDiscount: 0, promotions: [freeShipping()] }),
      { lines, shipping: { mode: 'MANUAL', amount: 300 } },
      catalogOf(),
    );
    expect(gone.discountWarnings).toEqual([]);
  });

  it('a variant with two non-gift lines requires orderLineId (else INVALID_QUANTITY)', () => {
    const current = promoCurrent({
      promotions: [],
      orderDiscount: 0,
      lines: [
        existing({ id: 1, unitPrice: 2000, quantity: 2 }),
        existing({ id: 2, unitPrice: 2000, unitDiscount: 2000, quantity: 1 }),
      ],
    });
    const bad = simulateModification(
      current,
      { lines: [{ variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(),
    );
    expect(bad.errors).toContainEqual({ path: 'lines.0.orderLineId', code: 'INVALID_QUANTITY' });
    expect(bad.lineChanges.find((c) => c.orderLineId === 2)?.kind).not.toBe('REMOVED');

    const ok = simulateModification(
      current,
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 3 },
          { orderLineId: 2, variantId: 101, quantity: 1 },
        ],
        shipping: keep,
      },
      catalogOf(variant({ variantId: 101, productId: 1, stock: 10 })),
    );
    expect(ok.errors).toEqual([]);
    expect(ok.after.subtotal).toBe(6000);
  });

  it('one non-gift line plus a gift line of the same variant still resolves without orderLineId', () => {
    const r = simulateModification(
      promoCurrent({
        promotions: [],
        orderDiscount: 0,
        lines: [
          existing({ id: 1, unitPrice: 2000, quantity: 2 }),
          existing({ id: 2, unitPrice: 2000, unitDiscount: 2000, quantity: 1, isGift: true }),
        ],
      }),
      { lines: [{ variantId: 101, quantity: 3 }], shipping: keep },
      catalogOf(variant({ variantId: 101, productId: 1, stock: 10 })),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges.map((c) => [c.orderLineId, c.newQuantity])).toEqual([
      [1, 3],
      [2, 1],
    ]);
  });
});

describe('simulateModification: discounted lines keep their discount, extra units at full price (design 4.8)', () => {
  const freeLine = (over: Partial<ExistingLine> = {}) =>
    existing({ id: 2, unitPrice: 3000, unitDiscount: 3000, quantity: 1, ...over });
  const catalog = () => catalogOf(variant({ variantId: 101, productId: 1, sku: 'SKU-101', unitPrice: 3500, stock: 10 }));
  const current = (lines: ExistingLine[]) => ({
    lines,
    orderDiscount: 0,
    shippingOriginal: 0,
    shippingDiscount: 0,
    payments: paid(6000),
    refunds: [],
  });

  it('"buy 3 pay 2": the free line raised 1 → 4 stays 1 free unit, plus a new line of 3 at full price', () => {
    const lines = [existing({ id: 1, quantity: 2 }), freeLine()];
    const r = simulateModification(
      current(lines),
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 2 },
          { orderLineId: 2, variantId: 101, quantity: 4 },
        ],
        shipping: keep,
      },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges).toEqual([
      { kind: 'UNCHANGED', orderLineId: 1, variantId: 101, previousQuantity: 2, newQuantity: 2 },
      { kind: 'UNCHANGED', orderLineId: 2, variantId: 101, previousQuantity: 1, newQuantity: 1 },
      { kind: 'ADDED', variantId: 101, previousQuantity: 0, newQuantity: 3, sourceOrderLineId: 2 },
    ]);
    // 2 × 30 + 1 × 0 + 3 × 30 (the line's own price, not the catalog's 35).
    expect(r.after.subtotal).toBe(15000);
    expect(r.after.total).toBe(15000);
    expect(r.difference).toBe(9000);
    expect(r.stockMovements).toEqual([{ variantId: 101, quantity: -3 }]);
  });

  it('a capped percentage line raised 2 → 5 keeps 2 discounted units', () => {
    const lines = [existing({ id: 1, unitPrice: 1000, unitDiscount: 200, quantity: 2 })];
    const r = simulateModification(
      current(lines),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 5 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.after.subtotal).toBe(2 * 800 + 3 * 1000);
  });

  it('without orderLineId, the single discounted line resolves and only its units stay discounted', () => {
    const lines = [existing({ id: 1, unitPrice: 1000, unitDiscount: 200, quantity: 2 })];
    const r = simulateModification(
      current(lines),
      { lines: [{ variantId: 101, quantity: 3 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges.filter((c) => c.kind === 'ADDED')).toEqual([
      { kind: 'ADDED', variantId: 101, previousQuantity: 0, newQuantity: 1, sourceOrderLineId: 1 },
    ]);
    expect(r.after.subtotal).toBe(2600);
  });

  it('decreasing a discounted line keeps its per-unit discount', () => {
    const lines = [existing({ id: 1, unitPrice: 1000, unitDiscount: 200, quantity: 3 })];
    const r = simulateModification(
      current(lines),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges).toEqual([
      { kind: 'QUANTITY_CHANGED', orderLineId: 1, variantId: 101, previousQuantity: 3, newQuantity: 1 },
    ]);
    expect(r.after.subtotal).toBe(800);
  });

  it('the extra units are checked against stock', () => {
    const lines = [freeLine({ id: 1 })];
    const r = simulateModification(
      current(lines),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 4 }], shipping: keep },
      catalogOf(variant({ variantId: 101, productId: 1, stock: 2 })),
    );
    expect(r.errors).toEqual([{ path: 'lines.0.quantity', code: 'INSUFFICIENT_STOCK' }]);
  });

  it('a gift line cannot be raised', () => {
    const lines = [existing({ id: 1, quantity: 2 }), freeLine({ isGift: true })];
    const r = simulateModification(
      current(lines),
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 2 },
          { orderLineId: 2, variantId: 101, quantity: 2 },
        ],
        shipping: keep,
      },
      catalog(),
    );
    expect(r.errors).toEqual([{ path: 'lines.1.quantity', code: 'INVALID_QUANTITY' }]);
  });

  it('undiscounted lines still grow in place', () => {
    const lines = [existing({ id: 1, quantity: 1 })];
    const r = simulateModification(
      current(lines),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3 }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges).toEqual([
      { kind: 'QUANTITY_CHANGED', orderLineId: 1, variantId: 101, previousQuantity: 1, newQuantity: 3 },
    ]);
  });
});

describe('simulateModification: manual line discount (spec 4.1)', () => {
  const current = (lines: ExistingLine[]) => ({
    lines,
    orderDiscount: 0,
    shippingOriginal: 0,
    shippingDiscount: 0,
    payments: paid(6000),
    refunds: [],
  });
  const catalog = () => catalogOf(variant({ variantId: 101, productId: 1, unitPrice: 3500 }), variant());

  it('setting 10 % on a full-price line: unit discount round(price × 10 %), DISCOUNT_CHANGED', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 1999, quantity: 2 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 2, discountPercent: 10 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges).toEqual([
      {
        kind: 'DISCOUNT_CHANGED',
        orderLineId: 1,
        variantId: 101,
        previousQuantity: 2,
        newQuantity: 2,
        discount: { previousPercent: null, percent: 10, unitDiscount: 200, replacedPromotion: false },
      },
    ]);
    expect(r.after.subtotal).toBe(2 * 1799);
    expect(r.after.productDiscount).toBe(400);
    expect(r.stockMovements).toEqual([]);
    expect(r.discountWarnings).toEqual([]);
  });

  it('an unchanged percent is no change', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 200, manualDiscountPercent: 10 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1, discountPercent: 10 }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges).toEqual([
      { kind: 'UNCHANGED', orderLineId: 1, variantId: 101, previousQuantity: 1, newQuantity: 1 },
    ]);
    expect(r.difference).toBe(0);
  });

  it('a line without a manual percent and no field keeps its promotion discount', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 500, promotionIds: [7] })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges[0].kind).toBe('UNCHANGED');
    expect(r.after.subtotal).toBe(1500);
  });

  it('replacing a promotion discount: the manual one wins and the change says so', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 500, promotionIds: [7] })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1, discountPercent: 5 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges[0].discount).toEqual({
      previousPercent: null,
      percent: 5,
      unitDiscount: 100,
      replacedPromotion: true,
    });
    expect(r.after.subtotal).toBe(1900);
    expect(r.difference).toBe(400);
  });

  it('removing the percent returns the line to full price', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 200, manualDiscountPercent: 10 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1, discountPercent: null }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges[0]).toMatchObject({
      kind: 'DISCOUNT_CHANGED',
      discount: { previousPercent: 10, percent: null, unitDiscount: 0, replacedPromotion: false },
    });
    expect(r.after.subtotal).toBe(2000);
  });

  it('an absent field on a manual line removes it too (the editor always sends the percent)', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 200, manualDiscountPercent: 10 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 1 }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges[0].discount).toMatchObject({ percent: null, unitDiscount: 0 });
  });

  it('a line with shipped units cannot change its discount: DISCOUNT_LINE_SHIPPED', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, quantity: 2, shipped: 1 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 2, discountPercent: 10 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([{ path: 'lines.0.discountPercent', code: 'DISCOUNT_LINE_SHIPPED' }]);
  });

  it('a shipped line keeps a percent it already has', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 200, manualDiscountPercent: 10, quantity: 2, shipped: 1 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3, discountPercent: 10 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.after.subtotal).toBe(3 * 1800);
  });

  it('a gift line cannot take a percent; invalid values are INVALID_PERCENT', () => {
    const r = simulateModification(
      current([
        existing({ id: 1, unitPrice: 2000, quantity: 1 }),
        existing({ id: 2, variantId: 102, unitPrice: 1000, unitDiscount: 1000, isGift: true }),
      ]),
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 1, discountPercent: 100.5 },
          { orderLineId: 2, variantId: 102, quantity: 1, discountPercent: 10 },
          { variantId: 201, quantity: 1, discountPercent: 1.234 },
        ],
        shipping: keep,
      },
      catalog(),
    );
    expect(r.errors).toEqual([
      { path: 'lines.0.discountPercent', code: 'INVALID_PERCENT' },
      { path: 'lines.1.discountPercent', code: 'INVALID_PERCENT' },
      { path: 'lines.2.discountPercent', code: 'INVALID_PERCENT' },
    ]);
  });

  it('adding units to a manual line keeps the percent on the whole line (no split)', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 200, manualDiscountPercent: 10, quantity: 1 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 3, discountPercent: 10 }], shipping: keep },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges).toEqual([
      { kind: 'QUANTITY_CHANGED', orderLineId: 1, variantId: 101, previousQuantity: 1, newQuantity: 3 },
    ]);
    expect(r.after.subtotal).toBe(3 * 1800);
  });

  it('a promotion line raised with a new percent: the whole line takes it (no split)', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000, unitDiscount: 500, promotionIds: [7], quantity: 1 })]),
      { lines: [{ orderLineId: 1, variantId: 101, quantity: 2, discountPercent: 20 }], shipping: keep },
      catalog(),
    );
    expect(r.lineChanges).toEqual([
      {
        kind: 'QUANTITY_CHANGED',
        orderLineId: 1,
        variantId: 101,
        previousQuantity: 1,
        newQuantity: 2,
        discount: { previousPercent: null, percent: 20, unitDiscount: 400, replacedPromotion: true },
      },
    ]);
    expect(r.after.subtotal).toBe(2 * 1600);
  });

  it('a new line can carry a percent (priced on the catalog price)', () => {
    const r = simulateModification(
      current([existing({ id: 1, unitPrice: 2000 })]),
      {
        lines: [
          { orderLineId: 1, variantId: 101, quantity: 1 },
          { variantId: 201, quantity: 2, discountPercent: 50 },
        ],
        shipping: keep,
      },
      catalog(),
    );
    expect(r.errors).toEqual([]);
    expect(r.lineChanges[1]).toEqual({
      kind: 'ADDED',
      variantId: 201,
      previousQuantity: 0,
      newQuantity: 2,
      discount: { previousPercent: null, percent: 50, unitDiscount: 1250, replacedPromotion: false },
    });
    expect(r.after.subtotal).toBe(2000 + 2 * 1250);
  });
});
