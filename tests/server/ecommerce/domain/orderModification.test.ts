import { describe, it, expect } from 'vitest';
import {
  simulateModification,
  type ExistingLine,
  type CatalogVariant,
  type ModificationInput,
} from '../../../../server/src/services/modules/ecommerce/domain/orderModification';
import type { PaymentLike } from '../../../../server/src/services/modules/ecommerce/domain/orders';

const existing = (over: Partial<ExistingLine> = {}): ExistingLine => ({
  id: 1,
  variantId: 101,
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

    for (const amount of [-1, 1.5, Number.NaN]) {
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
});
