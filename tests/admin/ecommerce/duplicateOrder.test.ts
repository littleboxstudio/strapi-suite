import { describe, it, expect } from 'vitest';
import {
  duplicateDraft,
  duplicateQuoteNotices,
  dropUnavailableLines,
  restoreDuplicateShipping,
} from '../../../admin/src/ecommerce/utils/duplicateOrder';
import type { OrderLineDraft } from '../../../admin/src/ecommerce/utils/orderForm';
import type { Order, OrderQuote, ShippingOption } from '../../../admin/src/ecommerce/orderTypes';

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const orderLine = (over: Record<string, unknown> = {}) => ({
  id: 10,
  variantId: 1,
  productId: 100,
  sku: 'MUG',
  name: 'Mug',
  option: null,
  imageUrl: null,
  unitPrice: 1000,
  unitDiscount: 0,
  manualDiscountPercent: null,
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

const order = (over: Record<string, unknown> = {}): Order =>
  ({
    id: 7,
    reference: 1001,
    locale: 'pt',
    customer: { id: 3, firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '912345678' },
    shippingAddress: address,
    billingAddress: { ...address, nif: '123456789' },
    shippingMethod: { providerId: 'ctt', serviceId: 'EXPRESS', name: 'CTT Express' },
    pickupPoint: null,
    lines: [
      orderLine(),
      orderLine({ id: 11, variantId: 2, sku: 'TEE', name: 'Tee', option: 'M', quantity: 3, returnedQuantity: 1, manualDiscountPercent: 12.5 }),
      orderLine({ id: 12, variantId: 3, sku: 'CAP', name: 'Cap', quantity: 1, returnedQuantity: 1 }),
      orderLine({ id: 13, variantId: 9, sku: 'GIFT', name: 'Sticker', option: 'Blue', quantity: 1, isGift: true, promotionIds: [40] }),
    ],
    promotions: [{ promotionId: 40, code: null }, { promotionId: 41, code: 'VERAO20' }],
    promotionCodes: [
      { code: 'VERAO20', status: 'APPLIED', promotionId: 41 },
      { code: 'OLD', status: 'EXPIRED', promotionId: null },
    ],
    manualDiscounts: [
      { id: 1, kind: 'LEGACY', percent: null, amount: 300, reason: 'Legacy discount', createdAt: '', actor: '' },
      { id: 2, kind: 'FIXED', percent: null, amount: 500, reason: 'Gesture', createdAt: '', actor: '' },
      { id: 3, kind: 'PERCENT', percent: 10, amount: 650, reason: 'Loyal', createdAt: '', actor: '' },
    ],
    shippingLines: [],
    ...over,
  }) as unknown as Order;

describe('duplicateDraft', () => {
  const draft = duplicateDraft(order(), { legacyReason: 'Previous discount' });

  it('copies the customer, the locale and the addresses', () => {
    expect(draft.form.customer).toEqual({
      firstName: 'Ana',
      lastName: 'Silva',
      email: 'ana@example.com',
      phone: '912345678',
    });
    expect(draft.form.locale).toBe('pt');
    expect(draft.form.shippingAddress).toMatchObject({ line1: 'Rua A 1', country: 'PT' });
    // The billing table gets the order's own billing address, NIF included (never "same as shipping").
    expect(draft.form.billingSameAsShipping).toBe(false);
    expect(draft.form.billingAddress).toMatchObject({ line1: 'Rua A 1', nif: '123456789' });
  });

  it('copies a different billing address as it is', () => {
    const d = duplicateDraft(order({ billingAddress: { ...address, line1: 'Rua B 2' } }), { legacyReason: 'x' });
    expect(d.form.billingSameAsShipping).toBe(false);
    expect(d.form.billingAddress.line1).toBe('Rua B 2');
  });

  it('leaves the billing table empty when the order has no billing address', () => {
    const d = duplicateDraft(order({ billingAddress: null }), { legacyReason: 'x' });
    expect(Object.values(d.form.billingAddress).every((v) => v === '')).toBe(true);
  });

  it("pre-selects the order's automatic promotions; code promotions come back through their codes", () => {
    expect(draft.form.promotionIds).toEqual([40]);
    expect(draft.form.promotionCodes).toEqual(['VERAO20']);
    const d = duplicateDraft(
      order({
        promotions: [
          { promotionId: 40, code: null, method: 'AUTOMATIC' },
          { promotionId: 40, code: null, method: 'AUTOMATIC' },
          { promotionId: 42, code: null, method: 'AUTOMATIC' },
          { promotionId: 41, code: 'VERAO20', method: 'CODE' },
        ],
      }),
      { legacyReason: 'x' }
    );
    expect(d.form.promotionIds).toEqual([40, 42]);
    expect(d.form.shippingLines).toEqual([]);
  });

  it('copies the non-gift lines with the units not returned and their percent; empty ones are skipped', () => {
    expect(draft.form.lines.map((l) => [l.variantId, l.quantity, l.discount ?? ''])).toEqual([
      [1, 2, ''],
      [2, 2, '12.5'],
    ]);
    expect(draft.form.lines[1]).toMatchObject({ name: 'Tee', option: 'M', sku: 'TEE', unitPrice: 1000, stock: null });
  });

  it('merges two lines of the same variant with the same percent', () => {
    const d = duplicateDraft(
      order({ lines: [orderLine(), orderLine({ id: 14, quantity: 1 })] }),
      { legacyReason: 'x' }
    );
    expect(d.form.lines.map((l) => [l.variantId, l.quantity])).toEqual([[1, 3]]);
    expect(d.discountConflicts).toEqual([]);
  });

  it('keeps only the units of the first percent when a variant repeats with another one', () => {
    const d = duplicateDraft(
      order({
        lines: [
          orderLine({ manualDiscountPercent: 10 }),
          orderLine({ id: 14, quantity: 1, manualDiscountPercent: 20 }),
          orderLine({ id: 15, quantity: 4, manualDiscountPercent: 10 }),
        ],
      }),
      { legacyReason: 'x' }
    );
    expect(d.form.lines.map((l) => [l.variantId, l.quantity, l.discount])).toEqual([[1, 6, '10']]);
    expect(d.discountConflicts).toEqual(['Mug']);
  });

  it('copies the applied codes only', () => {
    expect(draft.form.promotionCodes).toEqual(['VERAO20']);
  });

  it('falls back to the promotions codes when the order has no code list', () => {
    const d = duplicateDraft(order({ promotionCodes: undefined }), { legacyReason: 'x' });
    expect(d.form.promotionCodes).toEqual(['VERAO20']);
  });

  it('maps each gift line to its promotion and keeps the gift names', () => {
    expect(draft.giftChoices).toEqual({ 40: 9 });
    expect(draft.giftNames).toEqual({ 9: 'Sticker — Blue' });
  });

  it('skips the manual discounts cut to 0', () => {
    const d = duplicateDraft(
      order({
        manualDiscounts: [
          { id: 1, kind: 'FIXED', percent: null, amount: 0, reason: 'Gone', createdAt: '', actor: '' },
          { id: 2, kind: 'PERCENT', percent: 10, amount: 0, reason: 'Gone too', createdAt: '', actor: '' },
          { id: 3, kind: 'LEGACY', percent: null, amount: 0, reason: 'Legacy', createdAt: '', actor: '' },
          { id: 4, kind: 'FIXED', percent: null, amount: 200, reason: 'Kept', createdAt: '', actor: '' },
        ],
      }),
      { legacyReason: 'x' }
    );
    expect(d.form.manualDiscounts!.map((m) => m.reason)).toEqual(['Kept']);
  });

  it('copies the manual discounts, a LEGACY one as FIXED with its amount and the translated reason', () => {
    expect(draft.form.manualDiscounts!.map(({ kind, value, reason }) => ({ kind, value, reason }))).toEqual([
      { kind: 'FIXED', value: 300, reason: 'Previous discount' },
      { kind: 'FIXED', value: 500, reason: 'Gesture' },
      { kind: 'PERCENT', value: 10, reason: 'Loyal' },
    ]);
    const keys = draft.form.manualDiscounts!.map((m) => m.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('keeps the shipping method aside (the form waits for the options)', () => {
    expect(draft.form.shippingLines).toEqual([]);
    expect(draft.shipping).toEqual({ providerId: 'ctt', serviceId: 'EXPRESS' });
    expect(draft.pickup).toBeNull();
  });

  it('falls back to the last shipping charge without a stored method', () => {
    const d = duplicateDraft(
      order({
        shippingMethod: null,
        shippingLines: [
          { id: 1, providerId: 'dpd-portugal', serviceId: 'CLASSIC' },
          { id: 2, providerId: 'ctt', serviceId: 'NORMAL' },
        ],
      }),
      { legacyReason: 'x' }
    );
    expect(d.shipping).toEqual({ providerId: 'ctt', serviceId: 'NORMAL' });
  });

  it('a pickup order: the customer address and the point', () => {
    const point = {
      id: 'PT123',
      name: 'Kiosk',
      address: 'Rua C',
      address2: null,
      postalCode: '2000-002',
      city: 'Santarém',
      country: 'PT',
      customerAddress: { ...address, line1: 'Home 5' },
    };
    const d = duplicateDraft(
      order({
        shippingAddress: { ...address, line1: 'Rua C' },
        shippingMethod: { providerId: 'dpd-portugal', serviceId: 'PICKUP' },
        pickupPoint: point,
      }),
      { legacyReason: 'x' }
    );
    expect(d.form.shippingAddress.line1).toBe('Home 5');
    expect(d.pickup).toEqual({
      point: { id: 'PT123', name: 'Kiosk', address: 'Rua C', address2: null, postalCode: '2000-002', city: 'Santarém', country: 'PT', openingHours: [] },
      postalCode: '2000-002',
    });
  });

  it('a store pickup order: the store without a postal code', () => {
    const d = duplicateDraft(
      order({
        shippingMethod: { providerId: 'store-pickup', serviceId: 'STORE' },
        pickupPoint: { id: 'S1', name: 'Shop', address: 'Rua D', address2: null, postalCode: '3000', city: 'Porto', country: 'PT' },
      }),
      { legacyReason: 'x' }
    );
    expect(d.pickup?.postalCode).toBe('');
    expect(d.pickup?.point.id).toBe('S1');
  });
});

const draftLine = (variantId: number, name: string): OrderLineDraft => ({
  variantId,
  name,
  option: null,
  sku: name,
  unitPrice: 100,
  stock: null,
  imageUrl: null,
  quantity: 1,
});

describe('dropUnavailableLines', () => {
  const lines = [draftLine(1, 'A'), draftLine(2, 'B'), draftLine(3, 'C')];

  it('drops the lines the quote reported as VARIANT_UNAVAILABLE', () => {
    const result = dropUnavailableLines(lines, [
      { path: 'lines.0.variantId', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.2.variantId', code: 'VARIANT_UNAVAILABLE' },
    ]);
    expect(result.lines.map((l) => l.variantId)).toEqual([2]);
    expect(result.dropped.map((l) => l.name)).toEqual(['A', 'C']);
  });

  it('keeps the same array for other errors', () => {
    const result = dropUnavailableLines(lines, [{ path: 'lines.1.quantity', code: 'INSUFFICIENT_STOCK' }]);
    expect(result.lines).toBe(lines);
    expect(result.dropped).toEqual([]);
  });
});

const quote = (over: Partial<OrderQuote> = {}): OrderQuote =>
  ({
    lines: [],
    promotions: [],
    codes: [],
    rejected: [],
    totals: {} as OrderQuote['totals'],
    shippingOption: null,
    exhaustive: true,
    giftOptions: [],
    ...over,
  }) as OrderQuote;

describe('duplicateQuoteNotices', () => {
  it('lists the codes that did not apply (waiting for shipping is not a refusal)', () => {
    const q = quote({
      codes: [
        { code: 'A', status: 'APPLIED', promotionId: 1 },
        { code: 'B', status: 'EXPIRED', promotionId: null },
        { code: 'C', status: 'AWAITING_SHIPPING', promotionId: 3 },
      ],
    });
    expect(duplicateQuoteNotices({ codes: ['A', 'B', 'C', 'D'], giftChoices: {} }, q).refusedCodes).toEqual([
      'B',
      'D',
    ]);
  });

  it('lists the gift variants the quote no longer gives', () => {
    const q = quote({
      lines: [{ isGift: true, variantId: 9 } as OrderQuote['lines'][number]],
    });
    expect(duplicateQuoteNotices({ codes: [], giftChoices: { 40: 9, 41: 8 } }, q).missingGifts).toEqual([8]);
  });
});

const option = (over: Partial<ShippingOption> = {}): ShippingOption => ({
  providerId: 'ctt',
  serviceId: 'EXPRESS',
  name: 'CTT Express',
  price: 500,
  tax: 23,
  ...over,
});

describe('restoreDuplicateShipping', () => {
  it('selects the same method when it is still offered', () => {
    expect(restoreDuplicateShipping({ providerId: 'ctt', serviceId: 'EXPRESS' }, null, [option()])).toEqual({
      shipping: { providerId: 'ctt', serviceId: 'EXPRESS' },
      pickup: null,
      notice: null,
      checkPoint: false,
    });
  });

  it('reports a method no longer offered', () => {
    expect(
      restoreDuplicateShipping({ providerId: 'ctt', serviceId: 'EXPRESS' }, null, [option({ serviceId: 'NORMAL' })])
    ).toMatchObject({ shipping: null, pickup: null, notice: 'METHOD_GONE' });
  });

  it('keeps a store that is still offered and reports one that is not', () => {
    const store = { id: 'S1', name: 'Shop', address: 'R', address2: null, postalCode: '', city: 'P', country: 'PT' };
    const pickup = { point: { ...store, openingHours: [] }, postalCode: '' };
    const offered = option({ providerId: 'store-pickup', serviceId: 'STORE', requiresPickupPoint: true, pickupPoints: [store] });
    expect(restoreDuplicateShipping({ providerId: 'store-pickup', serviceId: 'STORE' }, pickup, [offered])).toEqual({
      shipping: { providerId: 'store-pickup', serviceId: 'STORE', requiresPickupPoint: true },
      pickup,
      notice: null,
      checkPoint: false,
    });
    expect(
      restoreDuplicateShipping({ providerId: 'store-pickup', serviceId: 'STORE' }, pickup, [
        { ...offered, pickupPoints: [] },
      ])
    ).toMatchObject({ pickup: null, notice: 'PICKUP_GONE', checkPoint: false });
  });

  it('a DPD point is kept and must be checked with a search', () => {
    const point = { id: 'P1', name: 'K', address: 'R', address2: null, postalCode: '2000-002', city: 'S', country: 'PT', openingHours: [] };
    const result = restoreDuplicateShipping(
      { providerId: 'dpd-portugal', serviceId: 'PICKUP' },
      { point, postalCode: '2000-002' },
      [option({ providerId: 'dpd-portugal', serviceId: 'PICKUP', requiresPickupPoint: true })]
    );
    expect(result).toMatchObject({ notice: null, checkPoint: true });
    expect(result.pickup?.point.id).toBe('P1');
  });

  it('nothing to restore without a method', () => {
    expect(restoreDuplicateShipping(null, null, [option()])).toEqual({
      shipping: null,
      pickup: null,
      notice: null,
      checkPoint: false,
    });
  });
});
