import { describe, it, expect } from 'vitest';
import {
  addModifyLine,
  addressChanged,
  buildModificationInput,
  countLines,
  modifyFormFromOrder,
  removeModifyLine,
  restoreModifyLine,
  setModifyLineQuantity,
  toModificationErrorMap,
  validateModificationForm,
  type ModifyLineDraft,
  type ModifyOrderForm,
} from '../../../admin/src/ecommerce/utils/modification';
import type { Order, OrderLine, VariantSearchResult } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

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
  shipped: 0,
  pending: 2,
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

const keyOf = (form: ModifyOrderForm, variantId: number, isGift = false) =>
  form.lines.find((l: ModifyLineDraft) => l.variantId === variantId && l.isGift === isGift)!.key;

describe('modifyFormFromOrder', () => {
  it('copies the lines (net unit price), addresses and starts with KEEP shipping', () => {
    const form = modifyFormFromOrder(order());
    expect(form.lines).toHaveLength(3);
    expect(form.lines[0]).toMatchObject({
      orderLineId: 10,
      variantId: 1,
      unitPrice: 1000,
      quantity: 2,
      originalQuantity: 2,
      shipped: 0,
      isGift: false,
      removed: false,
    });
    expect(form.lines[2].isGift).toBe(true);
    expect(form.shippingAddress.city).toBe('Lisboa');
    expect(form.billingAddress.nif).toBe('123456789');
    expect(form.shippingMode).toBe('KEEP');
    expect(form.manualAmount).toBe('');
  });

  it('accepts orders without addresses', () => {
    const form = modifyFormFromOrder(order({ shippingAddress: null, billingAddress: null }));
    expect(form.shippingAddress.city).toBe('');
    expect(addressChanged(form.shippingAddress, form.originalShippingAddress)).toBe(false);
  });
});

describe('buildModificationInput', () => {
  it('sends existing lines with orderLineId and gift lines unchanged', () => {
    const form = modifyFormFromOrder(order());
    expect(buildModificationInput(form)).toEqual({
      lines: [
        { orderLineId: 10, variantId: 1, quantity: 2 },
        { orderLineId: 11, variantId: 2, quantity: 1 },
        { orderLineId: 12, variantId: 3, quantity: 1 },
      ],
      shipping: { mode: 'KEEP' },
    });
  });

  it('omits removed existing lines and sends new lines without orderLineId', () => {
    let form = modifyFormFromOrder(order());
    form = { ...form, lines: removeModifyLine(form.lines, keyOf(form, 1)) };
    form = { ...form, lines: addModifyLine(form.lines, variant()) };
    form = { ...form, lines: setModifyLineQuantity(form.lines, keyOf(form, 2), 3) };
    expect(buildModificationInput(form).lines).toEqual([
      { orderLineId: 11, variantId: 2, quantity: 3 },
      { orderLineId: 12, variantId: 3, quantity: 1 },
      { variantId: 5, quantity: 1 },
    ]);
  });

  it('keeps gift lines at their original quantity whatever the draft says', () => {
    const form = modifyFormFromOrder(order());
    const giftKey = keyOf(form, 3, true);
    const lines = form.lines.map((l) => (l.key === giftKey ? { ...l, quantity: 9, removed: true } : l));
    expect(buildModificationInput({ ...form, lines }).lines).toContainEqual({
      orderLineId: 12,
      variantId: 3,
      quantity: 1,
    });
  });

  it('sends RECALCULATE without amount and MANUAL with cents', () => {
    const form = modifyFormFromOrder(order());
    expect(buildModificationInput({ ...form, shippingMode: 'RECALCULATE' }).shipping).toEqual({
      mode: 'RECALCULATE',
    });
    expect(
      buildModificationInput({ ...form, shippingMode: 'MANUAL', manualAmount: '4,90' }).shipping
    ).toEqual({ mode: 'MANUAL', amount: 490 });
  });

  it('sends only the addresses that changed', () => {
    const form = modifyFormFromOrder(order());
    const changed = { ...form, shippingAddress: { ...form.shippingAddress, city: ' Porto ' } };
    expect(buildModificationInput(changed).addresses).toEqual({
      shipping: { ...address, city: 'Porto' },
    });
    const billing = { ...form, billingAddress: { ...form.billingAddress, company: 'ACME' } };
    expect(buildModificationInput(billing).addresses).toEqual({
      billing: { ...address, nif: '123456789', company: 'ACME' },
    });
    // Whitespace-only edits are not changes.
    const same = { ...form, shippingAddress: { ...form.shippingAddress, city: 'Lisboa ' } };
    expect(buildModificationInput(same).addresses).toBeUndefined();
  });
});

describe('line helpers', () => {
  it('removing a new line drops it; removing an existing line marks it and can be restored', () => {
    let form = modifyFormFromOrder(order());
    form = { ...form, lines: addModifyLine(form.lines, variant()) };
    const newKey = keyOf(form, 5);
    expect(removeModifyLine(form.lines, newKey)).toHaveLength(3);
    const existingKey = keyOf(form, 1);
    const removed = removeModifyLine(form.lines, existingKey);
    expect(removed.find((l) => l.key === existingKey)!.removed).toBe(true);
    const restored = restoreModifyLine(removed, existingKey);
    expect(restored.find((l) => l.key === existingKey)).toMatchObject({ removed: false, quantity: 2 });
  });

  it('gift lines cannot be removed or changed', () => {
    const form = modifyFormFromOrder(order());
    const giftKey = keyOf(form, 3, true);
    expect(removeModifyLine(form.lines, giftKey)).toEqual(form.lines);
    expect(setModifyLineQuantity(form.lines, giftKey, 5)).toEqual(form.lines);
  });

  it('adding a variant already on a (non-gift) line bumps it or restores it', () => {
    const form = modifyFormFromOrder(order());
    const bumped = addModifyLine(form.lines, variant({ variantId: 1 }));
    expect(bumped).toHaveLength(3);
    expect(bumped[0].quantity).toBe(3);
    const removed = removeModifyLine(form.lines, keyOf(form, 1));
    const restored = addModifyLine(removed, variant({ variantId: 1 }));
    expect(restored[0]).toMatchObject({ removed: false, quantity: 2 });
    // A gift line of the same variant is not touched: a new line is added.
    const withGiftVariant = addModifyLine(form.lines, variant({ variantId: 3 }));
    expect(withGiftVariant).toHaveLength(4);
  });

  it('does not add variants without stock', () => {
    const form = modifyFormFromOrder(order());
    expect(addModifyLine(form.lines, variant({ stock: 0 }))).toEqual(form.lines);
  });
});

describe('validateModificationForm', () => {
  it('flags invalid quantities, quantities below shipped and bad manual amounts', () => {
    let form = modifyFormFromOrder(order());
    form = { ...form, lines: setModifyLineQuantity(form.lines, keyOf(form, 1), 0) };
    form = { ...form, lines: setModifyLineQuantity(form.lines, keyOf(form, 2), 0) };
    form = { ...form, shippingMode: 'MANUAL', manualAmount: 'abc' };
    expect(validateModificationForm(form)).toEqual([
      { path: 'lines.0.quantity', code: 'INVALID_QUANTITY' },
      { path: 'lines.1.quantity', code: 'INVALID_QUANTITY' },
      { path: 'shipping.amount', code: 'INVALID_AMOUNT' },
    ]);
    form = { ...form, lines: setModifyLineQuantity(form.lines, keyOf(form, 1), 1) };
    form = { ...form, lines: setModifyLineQuantity(form.lines, keyOf(form, 2), 1) };
    expect(validateModificationForm({ ...form, manualAmount: '0' })).toEqual([]);
  });

  it('flags a removed line that was already shipped', () => {
    const form = modifyFormFromOrder(order());
    const lines = removeModifyLine(form.lines, keyOf(form, 2));
    expect(validateModificationForm({ ...form, lines })).toEqual([
      { path: 'removed.11', code: 'QUANTITY_BELOW_SHIPPED' },
    ]);
  });

  it('requires at least one line', () => {
    const form = modifyFormFromOrder(order({ lines: [orderLine()] } as any));
    const lines = removeModifyLine(form.lines, keyOf(form, 1));
    expect(validateModificationForm({ ...form, lines })).toEqual([
      { path: 'lines', code: 'LINES_REQUIRED' },
    ]);
    expect(toModificationErrorMap({ ...form, lines }, [{ path: 'lines', code: 'LINES_REQUIRED' }])).toEqual({
      lines: 'LINES_REQUIRED',
    });
  });

  it('requires the fields of a changed address', () => {
    const form = modifyFormFromOrder(order());
    const changed = { ...form, shippingAddress: { ...form.shippingAddress, city: '' } };
    expect(validateModificationForm(changed)).toEqual([
      { path: 'addresses.shipping.city', code: 'required' },
    ]);
  });
});

describe('toModificationErrorMap', () => {
  it('maps server paths to the line keys and fields of the form', () => {
    let form = modifyFormFromOrder(order());
    form = { ...form, lines: removeModifyLine(form.lines, keyOf(form, 1)) };
    form = { ...form, lines: addModifyLine(form.lines, variant()) };
    const map = toModificationErrorMap(form, [
      { path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' },
      { path: 'lines.2.quantity', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.0.quantity', code: 'QUANTITY_BELOW_SHIPPED' },
      { path: 'removed.10', code: 'QUANTITY_BELOW_SHIPPED' },
      { path: 'addresses.shipping.country', code: 'invalid_country' },
      { path: 'addresses.billing.city', code: 'required' },
      { path: 'shipping', code: 'SHIPPING_QUOTE_FAILED' },
      { path: 'shipping.amount', code: 'INVALID_AMOUNT' },
      { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
    ]);
    expect(map).toEqual({
      [`line.${keyOf(form, 5)}`]: 'INSUFFICIENT_STOCK',
      [`line.${keyOf(form, 2)}`]: 'QUANTITY_BELOW_SHIPPED',
      [`line.${keyOf(form, 1)}`]: 'QUANTITY_BELOW_SHIPPED',
      'shippingAddress.country': 'invalid_country',
      'billingAddress.city': 'required',
      shipping: 'SHIPPING_QUOTE_FAILED',
      'shipping.amount': 'INVALID_AMOUNT',
      form: 'OPERATION_ID_CONFLICT',
    });
  });

  it('maps shipping.quote to the shipping field', () => {
    const form = modifyFormFromOrder(order());
    expect(toModificationErrorMap(form, [{ path: 'shipping.quote', code: 'INVALID_AMOUNT' }])).toEqual({
      shipping: 'INVALID_AMOUNT',
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

describe('translations', () => {
  const keys = [
    'ecommerce.orders.modify.title',
    'ecommerce.orders.modify.review',
    'ecommerce.orders.modify.confirm',
    'ecommerce.orders.modify.back',
    'ecommerce.orders.modify.shipping.KEEP',
    'ecommerce.orders.modify.shipping.RECALCULATE',
    'ecommerce.orders.modify.shipping.MANUAL',
    'ecommerce.orders.modify.summary.title',
    'ecommerce.orders.modify.warnings.ORDER_DISCOUNT_CAPPED',
    'ecommerce.orders.modify.refundable',
    'ecommerce.orders.supplementary.title',
    'ecommerce.orders.supplementary.manual',
    'ecommerce.orders.supplementary.stripe',
    'ecommerce.orders.supplementary.sendLater',
    'ecommerce.orders.supplementary.unavailable',
    'ecommerce.orders.errors.QUANTITY_BELOW_SHIPPED',
    'ecommerce.orders.errors.SHIPPING_QUOTE_FAILED',
    'ecommerce.orders.errors.INVALID_AMOUNT',
    'ecommerce.orders.errors.LINES_REQUIRED',
  ];
  it.each(keys)('%s exists in en and pt', (key) => {
    const id = `littlebox-strapi-suite.${key}`;
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });

  it('uses the agreed copy', () => {
    expect(en['littlebox-strapi-suite.ecommerce.orders.supplementary.unavailable']).toBe(
      'Available once email/Stripe are configured'
    );
    expect(en['littlebox-strapi-suite.ecommerce.orders.modify.refundable']).toBe(
      'There is an amount eligible for refund'
    );
  });
});
