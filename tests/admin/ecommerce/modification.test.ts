import { describe, it, expect } from 'vitest';
import {
  addModifyLine,
  buildLinesInput,
  countLines,
  linesDraftChanged,
  linesDraftFromOrder,
  removeModifyLine,
  restoreModifyLine,
  setModifyLineQuantity,
  toModificationErrorMap,
  validateLinesDraft,
  type ModifyLineDraft,
} from '../../../admin/src/ecommerce/utils/modification';
import type { Order, OrderLine, VariantSearchResult } from '../../../admin/src/ecommerce/orderTypes';

const orderLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 10,
  variantId: 1,
  productId: 100,
  sku: 'MUG',
  name: 'Mug',
  option: null,
  imageUrl: null,
  unitPrice: 1250,
  unitDiscount: 250,
  quantity: 2,
  returnedQuantity: 0,
  tax: 23,
  isGift: false,
  promotionIds: [],
  shipped: 0,
  reserved: 0,
  pending: 2,
  returnable: 0,
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

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: 7,
    reference: 1001,
    shippingAddress: address,
    billingAddress: { ...address, nif: '123456789' },
    lines: [
      orderLine(),
      orderLine({ id: 11, variantId: 2, sku: 'TEE', name: 'Tee', option: 'M', quantity: 1, shipped: 1 }),
      orderLine({ id: 12, variantId: 3, sku: 'GIFT', name: 'Sticker', quantity: 1, isGift: true, unitDiscount: 1250 }),
    ],
    ...over,
  }) as unknown as Order;

const variant = (over: Partial<VariantSearchResult> = {}): VariantSearchResult => ({
  variantId: 5,
  productId: 500,
  name: 'Cap',
  option: null,
  sku: 'CAP',
  price: 900,
  stock: 3,
  imageUrl: null,
  ...over,
});

const keyOf = (lines: ModifyLineDraft[], variantId: number, isGift = false) =>
  lines.find((l) => l.variantId === variantId && l.isGift === isGift)!.key;

describe('linesDraftFromOrder', () => {
  it('copies the lines with the net unit price', () => {
    const lines = linesDraftFromOrder(order());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      orderLineId: 10,
      variantId: 1,
      unitPrice: 1000,
      quantity: 2,
      originalQuantity: 2,
      shipped: 0,
      isGift: false,
      removed: false,
    });
    expect(lines[2].isGift).toBe(true);
  });
});

describe('buildLinesInput', () => {
  it('sends existing lines with orderLineId and gift lines unchanged', () => {
    expect(buildLinesInput(linesDraftFromOrder(order()))).toEqual({
      lines: [
        { orderLineId: 10, variantId: 1, quantity: 2 },
        { orderLineId: 11, variantId: 2, quantity: 1 },
        { orderLineId: 12, variantId: 3, quantity: 1 },
      ],
    });
  });

  it('omits removed existing lines and sends new lines without orderLineId', () => {
    let lines = linesDraftFromOrder(order());
    lines = removeModifyLine(lines, keyOf(lines, 1));
    lines = addModifyLine(lines, variant());
    lines = setModifyLineQuantity(lines, keyOf(lines, 2), 3);
    expect(buildLinesInput(lines).lines).toEqual([
      { orderLineId: 11, variantId: 2, quantity: 3 },
      { orderLineId: 12, variantId: 3, quantity: 1 },
      { variantId: 5, quantity: 1 },
    ]);
  });

  it('keeps gift lines at their original quantity whatever the draft says', () => {
    const draft = linesDraftFromOrder(order());
    const giftKey = keyOf(draft, 3, true);
    const lines = draft.map((l) => (l.key === giftKey ? { ...l, quantity: 9, removed: true } : l));
    expect(buildLinesInput(lines).lines).toContainEqual({ orderLineId: 12, variantId: 3, quantity: 1 });
  });

  it('sends every line of a variant split over several lines with its own orderLineId', () => {
    const split = order({
      lines: [
        orderLine({ id: 20, variantId: 1, quantity: 2, unitDiscount: 0 }),
        orderLine({ id: 21, variantId: 1, quantity: 1, unitDiscount: 1250 }),
      ],
    });
    expect(buildLinesInput(linesDraftFromOrder(split)).lines).toEqual([
      { orderLineId: 20, variantId: 1, quantity: 2 },
      { orderLineId: 21, variantId: 1, quantity: 1 },
    ]);
  });
});

describe('line helpers', () => {
  it('removing a new line drops it; removing an existing line marks it and can be restored', () => {
    let lines = linesDraftFromOrder(order());
    lines = addModifyLine(lines, variant());
    expect(removeModifyLine(lines, keyOf(lines, 5))).toHaveLength(3);
    const existingKey = keyOf(lines, 1);
    const removed = removeModifyLine(lines, existingKey);
    expect(removed.find((l) => l.key === existingKey)!.removed).toBe(true);
    const restored = restoreModifyLine(removed, existingKey);
    expect(restored.find((l) => l.key === existingKey)).toMatchObject({ removed: false, quantity: 2 });
  });

  it('gift lines cannot be removed or changed', () => {
    const lines = linesDraftFromOrder(order());
    const giftKey = keyOf(lines, 3, true);
    expect(removeModifyLine(lines, giftKey)).toEqual(lines);
    expect(setModifyLineQuantity(lines, giftKey, 5)).toEqual(lines);
  });

  it('adding a variant already on a (non-gift) line bumps it or restores it', () => {
    const lines = linesDraftFromOrder(order());
    const bumped = addModifyLine(lines, variant({ variantId: 1 }));
    expect(bumped).toHaveLength(3);
    expect(bumped[0].quantity).toBe(3);
    const removed = removeModifyLine(lines, keyOf(lines, 1));
    expect(addModifyLine(removed, variant({ variantId: 1 }))[0]).toMatchObject({ removed: false, quantity: 2 });
    expect(addModifyLine(lines, variant({ variantId: 3 }))).toHaveLength(4);
  });

  it('does not add variants without stock', () => {
    const lines = linesDraftFromOrder(order());
    expect(addModifyLine(lines, variant({ stock: 0 }))).toEqual(lines);
  });
});

describe('validateLinesDraft', () => {
  it('flags invalid quantities', () => {
    let lines = linesDraftFromOrder(order());
    lines = setModifyLineQuantity(lines, keyOf(lines, 1), 0);
    lines = setModifyLineQuantity(lines, keyOf(lines, 2), 0);
    expect(validateLinesDraft(lines)).toEqual([
      { path: 'lines.0.quantity', code: 'INVALID_QUANTITY' },
      { path: 'lines.1.quantity', code: 'INVALID_QUANTITY' },
    ]);
    lines = setModifyLineQuantity(lines, keyOf(lines, 1), 1);
    lines = setModifyLineQuantity(lines, keyOf(lines, 2), 1);
    expect(validateLinesDraft(lines)).toEqual([]);
  });

  it('flags a removed line that was already shipped', () => {
    const draft = linesDraftFromOrder(order());
    expect(validateLinesDraft(removeModifyLine(draft, keyOf(draft, 2)))).toEqual([
      { path: 'removed.11', code: 'QUANTITY_BELOW_SHIPPED' },
    ]);
  });

  it('requires at least one line', () => {
    const draft = linesDraftFromOrder(order({ lines: [orderLine()] } as any));
    const lines = removeModifyLine(draft, keyOf(draft, 1));
    expect(validateLinesDraft(lines)).toEqual([{ path: 'lines', code: 'LINES_REQUIRED' }]);
    expect(toModificationErrorMap(lines, [{ path: 'lines', code: 'LINES_REQUIRED' }])).toEqual({
      lines: 'LINES_REQUIRED',
    });
  });
});

describe('toModificationErrorMap', () => {
  it('maps server paths to the line keys of the draft', () => {
    let lines = linesDraftFromOrder(order());
    lines = removeModifyLine(lines, keyOf(lines, 1));
    lines = addModifyLine(lines, variant());
    expect(
      toModificationErrorMap(lines, [
        { path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' },
        { path: 'lines.2.quantity', code: 'VARIANT_UNAVAILABLE' },
        { path: 'lines.0.quantity', code: 'QUANTITY_BELOW_SHIPPED' },
        { path: 'removed.10', code: 'QUANTITY_BELOW_SHIPPED' },
        { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
      ])
    ).toEqual({
      [`line.${keyOf(lines, 5)}`]: 'INSUFFICIENT_STOCK',
      [`line.${keyOf(lines, 2)}`]: 'QUANTITY_BELOW_SHIPPED',
      [`line.${keyOf(lines, 1)}`]: 'QUANTITY_BELOW_SHIPPED',
      form: 'OPERATION_ID_CONFLICT',
    });
  });
});

describe('countLines', () => {
  it('counts products and units before and after', () => {
    expect(
      countLines([
        { kind: 'UNCHANGED', orderLineId: 1, variantId: 1, previousQuantity: 2, newQuantity: 2 },
        { kind: 'REMOVED', orderLineId: 2, variantId: 2, previousQuantity: 1, newQuantity: 0 },
        { kind: 'ADDED', variantId: 3, previousQuantity: 0, newQuantity: 4 },
      ])
    ).toEqual({ before: { products: 2, units: 3 }, after: { products: 2, units: 6 } });
  });
});

describe('linesDraftChanged', () => {
  it('is false for an untouched draft and true after any edit', () => {
    const lines = linesDraftFromOrder(order());
    expect(linesDraftChanged(lines)).toBe(false);
    expect(linesDraftChanged(setModifyLineQuantity(lines, keyOf(lines, 1), 3))).toBe(true);
    expect(linesDraftChanged(addModifyLine(lines, variant()))).toBe(true);
    expect(linesDraftChanged(removeModifyLine(lines, keyOf(lines, 1)))).toBe(true);
  });

  it('is false again once an edit is undone', () => {
    const lines = linesDraftFromOrder(order());
    const key = keyOf(lines, 1);
    expect(linesDraftChanged(restoreModifyLine(removeModifyLine(lines, key), key))).toBe(false);
    expect(linesDraftChanged(setModifyLineQuantity(lines, key, 2))).toBe(false);
  });
});
