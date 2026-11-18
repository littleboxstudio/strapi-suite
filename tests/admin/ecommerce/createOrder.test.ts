import { describe, it, expect } from 'vitest';
import {
  addPromotionCodes,
  addressFormErrors,
  customerFormErrors,
  fieldErrors,
  giftLineKey,
  keptPromotionIds,
  applicablePromotionsInput,
  applyCustomerAddresses,
  applyDiscountRows,
  hasAddress,
  hasCustomer,
  isQuoteErrorPath,
  sectionError,
  shippingLineError,
  shippingLineFromOption,
  toggleId,
  unappliedCodes,
} from '../../../admin/src/ecommerce/utils/createOrder';
import {
  emptyAddressForm,
  emptyOrderForm,
  type OrderForm,
} from '../../../admin/src/ecommerce/utils/orderForm';
import type {
  ApplicablePromotion,
  AppliedPromotion,
  OrderQuote,
} from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

describe('hasCustomer and hasAddress', () => {
  it('a customer or an address is there as soon as one field is filled', () => {
    expect(hasCustomer({ firstName: '', lastName: '', email: '', phone: '' })).toBe(false);
    expect(hasCustomer({ firstName: ' ', lastName: '', email: '', phone: '' })).toBe(false);
    expect(hasCustomer({ firstName: '', lastName: '', email: 'a@b.pt', phone: '' })).toBe(true);
    expect(hasAddress(emptyAddressForm())).toBe(false);
    expect(hasAddress({ ...emptyAddressForm(), city: 'Porto' })).toBe(true);
  });
});

describe('sectionError', () => {
  const errors = {
    'customer.email': 'invalid_email',
    'shippingAddress.city': 'required',
    shippingLines: 'required',
  };

  it('is the first error of the section (the path itself or below it)', () => {
    expect(sectionError(errors, 'customer')).toEqual({
      path: 'customer.email',
      field: 'email',
      code: 'invalid_email',
    });
    expect(sectionError(errors, 'shippingLines')).toEqual({
      path: 'shippingLines',
      field: null,
      code: 'required',
    });
    expect(sectionError(errors, 'billingAddress')).toBeNull();
    // A prefix of another section's name is not that section.
    expect(sectionError({ customerX: 'required' }, 'customer')).toBeNull();
  });
});

describe('applyCustomerAddresses', () => {
  const form = (): OrderForm => ({
    ...emptyOrderForm('pt'),
    shippingAddress: { ...emptyAddressForm(), city: 'Typed' },
  });

  it('fills both tables from the last addresses', () => {
    const next = applyCustomerAddresses(form(), {
      shippingAddress: address,
      billingAddress: { ...address, nif: '123456789', city: 'Porto' },
    });
    expect(next.shippingAddress.city).toBe('Lisboa');
    expect(next.billingAddress).toMatchObject({ city: 'Porto', nif: '123456789' });
    expect(next.billingSameAsShipping).toBe(false);
  });

  it("clears an address the picked customer does not have: B never keeps A's billing or NIF", () => {
    const withA: OrderForm = {
      ...form(),
      shippingAddress: { ...emptyAddressForm(), ...address, city: 'Lisboa A' },
      billingAddress: { ...emptyAddressForm(), ...address, company: 'A Lda', nif: '111111111' },
    };
    const next = applyCustomerAddresses(withA, {
      shippingAddress: { ...address, city: 'Porto' },
      billingAddress: null,
    });
    expect(next.shippingAddress.city).toBe('Porto');
    expect(next.billingAddress).toEqual(emptyAddressForm());
    const none = applyCustomerAddresses(withA, { shippingAddress: null, billingAddress: null });
    expect(none.shippingAddress).toEqual(emptyAddressForm());
    expect(none.billingAddress).toEqual(emptyAddressForm());
  });
});

describe('shipping lines', () => {
  const option = { providerId: 'ctt', serviceId: 'EXP', name: 'CTT Express', price: 650, tax: 23 };

  it('shippingLineFromOption keeps the method, the entered amount and the pickup', () => {
    expect(shippingLineFromOption(option, 400, null, 'k1')).toEqual({
      key: 'k1',
      providerId: 'ctt',
      serviceId: 'EXP',
      name: 'CTT Express',
      amount: 400,
      pickup: null,
    });
    const store = {
      point: {
        id: 'S1',
        name: 'Shop',
        address: 'R',
        address2: null,
        postalCode: '',
        city: 'P',
        country: 'PT',
        openingHours: [],
      },
      postalCode: '',
    };
    expect(
      shippingLineFromOption(
        { ...option, providerId: 'store-pickup', requiresPickupPoint: true },
        0,
        store,
        'k2'
      )
    ).toMatchObject({ requiresPickupPoint: true, pickup: store, amount: 0 });
  });

  it('shippingLineError reads the first error of line N', () => {
    expect(shippingLineError({ 'shippingLines.1': 'SHIPPING_METHOD_UNAVAILABLE' }, 1)).toBe(
      'SHIPPING_METHOD_UNAVAILABLE'
    );
    expect(shippingLineError({ 'shippingLines.0.amount': 'INVALID_AMOUNT' }, 0)).toBe(
      'INVALID_AMOUNT'
    );
    expect(shippingLineError({ 'shippingLines.0.pickupPointId': 'PICKUP_POINT_INVALID' }, 0)).toBe(
      'PICKUP_POINT_INVALID'
    );
    expect(shippingLineError({ 'shippingLines.0.amount': 'INVALID_AMOUNT' }, 1)).toBeUndefined();
  });

  it('isQuoteErrorPath: the paths a quote answers for (replaced by each new quote)', () => {
    [
      'manualDiscounts.0.value',
      'shippingLines',
      'shippingLines.1',
      'destination.country',
      'promotionIds.0',
    ].forEach((p) => expect(isQuoteErrorPath(p), p).toBe(true));
    ['customer.email', 'lines.0.quantity', 'shippingAddress.city'].forEach((p) =>
      expect(isQuoteErrorPath(p), p).toBe(false)
    );
  });
});

describe('applicable promotions', () => {
  it('applicablePromotionsInput: the cart, codes, gift choices and the shipping amounts', () => {
    const form: OrderForm = {
      ...emptyOrderForm('pt'),
      customer: { firstName: '', lastName: '', email: 'nope', phone: '' },
      lines: [
        {
          variantId: 1,
          name: 'Mug',
          option: null,
          sku: 'M',
          unitPrice: 1000,
          stock: 3,
          imageUrl: null,
          quantity: 2,
          discount: '10',
        },
      ],
      promotionCodes: ['verao'],
      shippingLines: [
        { key: 'a', providerId: 'ctt', serviceId: 'x', name: 'CTT', amount: 500, pickup: null },
        { key: 'b', providerId: 'ctt', serviceId: 'y', name: 'CTT', amount: 250, pickup: null },
      ],
    };
    expect(applicablePromotionsInput(form, { 4: 31 })).toEqual({
      lines: [{ variantId: 1, quantity: 2, discountPercent: 10 }],
      locale: 'pt',
      email: null,
      promotionCodes: ['VERAO'],
      giftChoices: { 4: 31 },
      shippingLines: [{ amount: 500 }, { amount: 250 }],
    });
  });

  const applicable = (over: Partial<ApplicablePromotion> = {}): ApplicablePromotion => ({
    id: 3,
    name: 'Summer',
    displayName: { pt: 'Verão' },
    classes: ['ORDER_DISCOUNT'],
    benefits: [],
    amount: 500,
    ...over,
  });

  it('applyDiscountRows lists the applicable ones, then the selected ones no longer listed', () => {
    const known = [
      {
        promotionId: 8,
        name: 'Old',
        displayName: {},
        classes: ['SHIPPING_DISCOUNT'],
        benefits: [],
      },
    ] as unknown as AppliedPromotion[];
    const rows = applyDiscountRows(
      [applicable(), applicable({ id: 5, name: 'Gift', amount: 0 })],
      [5, 8, 9],
      known
    );
    expect(rows.map((r) => [r.id, r.name, r.amount, r.listed])).toEqual([
      [3, 'Summer', 500, true],
      [5, 'Gift', 0, true],
      [8, 'Old', null, false],
      [9, '#9', null, false],
    ]);
    expect(rows[2].classes).toEqual(['SHIPPING_DISCOUNT']);
  });

  it('toggleId adds or removes an id, keeping the order', () => {
    expect(toggleId([3, 5], 5)).toEqual([3]);
    expect(toggleId([3], 5)).toEqual([3, 5]);
  });
});

describe('promotion codes picked from the search', () => {
  it('addPromotionCodes adds each new code, refusing repeats and codes over the limit', () => {
    expect(addPromotionCodes(['A1X'], ['b2y', 'A1X'])).toEqual({
      codes: ['A1X', 'B2Y'],
      refused: [{ code: 'A1X', error: 'duplicate' }],
    });
    expect(addPromotionCodes(['AAA', 'BBB', 'CCC', 'DDD'], ['EEE', 'FFF']).refused).toEqual([
      { code: 'FFF', error: 'too_many' },
    ]);
  });

  it('unappliedCodes: the added codes the quote did not apply, with their status', () => {
    const quote = {
      codes: [
        { code: 'VERAO', status: 'APPLIED', promotionId: 1 },
        { code: 'OLD', status: 'EXPIRED', promotionId: null },
      ],
    } as unknown as OrderQuote;
    expect(unappliedCodes(['VERAO', 'OLD', 'NEW'], quote)).toEqual([
      { code: 'OLD', status: 'EXPIRED' },
      { code: 'NEW', status: null },
    ]);
    expect(unappliedCodes(['VERAO'], null)).toEqual([{ code: 'VERAO', status: null }]);
  });
});

describe('modal checks', () => {
  it('customerFormErrors: names and a valid e-mail are required, keyed by field', () => {
    expect(customerFormErrors({ firstName: '', lastName: 'S', email: 'nope', phone: '' })).toEqual({
      firstName: 'required',
      email: 'invalid_email',
    });
    expect(
      customerFormErrors({ firstName: 'A', lastName: 'S', email: ' a@b.pt ', phone: '' })
    ).toEqual({});
  });

  it('addressFormErrors: the required address fields, keyed by field', () => {
    expect(addressFormErrors({ ...emptyAddressForm(), ...address, city: ' ' })).toEqual({
      city: 'required',
    });
    expect(Object.keys(addressFormErrors(emptyAddressForm()))).toEqual([
      'firstName',
      'lastName',
      'line1',
      'postalCode',
      'city',
      'country',
    ]);
  });

  it('fieldErrors: the errors of one section, keyed by the field below it', () => {
    expect(
      fieldErrors(
        { 'customer.email': 'invalid_email', 'shippingAddress.city': 'required', customer: 'x' },
        'customer'
      )
    ).toEqual({ email: 'invalid_email' });
  });
});

describe('create order v2 translations', () => {
  it.each([
    'ecommerce.orders.new.customerEmpty',
    'ecommerce.orders.new.customerAdd',
    'ecommerce.orders.new.customerSearch',
    'ecommerce.orders.new.addressEmpty',
    'ecommerce.orders.new.shippingAddressAdd',
    'ecommerce.orders.new.billingAddressAdd',
    'ecommerce.orders.new.shippingEmpty',
    'ecommerce.orders.new.applyDiscount',
    'ecommerce.orders.new.addCode',
    'ecommerce.orders.new.codeSearch',
  ])('%s is translated in en and pt', (k) => {
    const key = `littlebox-strapi-suite.${k}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });
});

describe('fix round 1', () => {
  it('keptPromotionIds keeps the selected ids the endpoint still returns, in order, and names the others', () => {
    const applicable = [{ id: 5 }, { id: 3 }] as ApplicablePromotion[];
    expect(keptPromotionIds([3, 7, 5, 9], applicable)).toEqual({ kept: [3, 5], dropped: [7, 9] });
    expect(keptPromotionIds([], applicable)).toEqual({ kept: [], dropped: [] });
  });

  it('giftLineKey is unique per promotion benefit and variant', () => {
    const gift = (variantId: number, refs: { promotionId: number; benefitIndex: number }[]) =>
      ({
        variantId,
        refs: refs.map((r) => ({ ...r, amount: 0 })),
      }) as unknown as OrderQuote['lines'][number];
    const keys = [
      giftLineKey(gift(9, [{ promotionId: 1, benefitIndex: 0 }])),
      giftLineKey(gift(9, [{ promotionId: 2, benefitIndex: 0 }])),
      giftLineKey(gift(9, [{ promotionId: 1, benefitIndex: 1 }])),
      giftLineKey(gift(8, [{ promotionId: 1, benefitIndex: 0 }])),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('has en + pt copy for the fix round', () => {
    [
      'ecommerce.orders.new.duplicate.droppedPromotions',
      'ecommerce.orders.new.pickupDeliveryOnly',
    ].forEach((k) => {
      expect(en[`littlebox-strapi-suite.${k}`], k).toEqual(expect.any(String));
      expect(pt[`littlebox-strapi-suite.${k}`], k).toEqual(expect.any(String));
    });
  });
});
