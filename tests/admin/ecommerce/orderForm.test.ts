import { describe, it, expect } from 'vitest';
import {
  addLine,
  addressFormFromAddress,
  buildCreateOrderInput,
  copyAddress,
  emptyAddressForm,
  emptyOrderForm,
  lineSubtotal,
  lineUnitNet,
  sumPreviewTotals,
  toOrderErrorMap,
  validateOrderForm,
  addPromotionCode,
  buildQuoteInput,
  createOrderConflict,
  giftChoicesFromQuote,
  giftSelectors,
  normalizePromotionCodes,
  pruneGiftChoices,
  type OrderForm,
  type OrderLineDraft,
} from '../../../admin/src/ecommerce/utils/orderForm';
import type { OrderQuote, VariantSearchResult } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

const line = (over: Partial<OrderLineDraft> = {}): OrderLineDraft => ({
  variantId: 1,
  name: 'Mug',
  option: null,
  sku: 'MUG',
  unitPrice: 1250,
  stock: 10,
  imageUrl: null,
  quantity: 1,
  ...over,
});

const variant = (over: Partial<VariantSearchResult> = {}): VariantSearchResult => ({
  variantId: 7,
  productId: 3,
  name: 'Tee',
  option: 'M',
  sku: 'TEE-M',
  price: 2000,
  stock: 5,
  imageUrl: null,
  ...over,
});

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  line2: '',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  phone: '',
  company: '',
  nif: '',
};

const validForm = (): OrderForm => ({
  ...emptyOrderForm('pt'),
  customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '' },
  shippingAddress: { ...address },
  lines: [line()],
  shipping: { providerId: 'manual', serviceId: '1' },
});

describe('sumPreviewTotals', () => {
  it('sums the lines and adds the shipping price', () => {
    expect(
      sumPreviewTotals([line({ unitPrice: 1250, quantity: 2 }), line({ unitPrice: 300, quantity: 3 })], 499)
    ).toEqual({ subtotal: 3400, shipping: 499, total: 3899 });
  });

  it('treats a missing shipping price as zero', () => {
    expect(sumPreviewTotals([line({ unitPrice: 100, quantity: 1 })], null)).toEqual({
      subtotal: 100,
      shipping: 0,
      total: 100,
    });
  });

  it('ignores lines with an invalid quantity', () => {
    expect(sumPreviewTotals([line({ quantity: 0 }), line({ quantity: 1.5 })], 0).subtotal).toBe(0);
  });

  it('lineSubtotal is unit price times quantity', () => {
    expect(lineSubtotal(line({ unitPrice: 1250, quantity: 3 }))).toBe(3750);
  });
});

describe('copyAddress', () => {
  it('copies the shared fields and keeps company and nif of the target', () => {
    const target = { ...emptyAddressForm(), company: 'ACME', nif: '123456789', city: 'Porto' };
    expect(copyAddress({ ...address, company: 'Other', nif: '999' }, target)).toEqual({
      ...address,
      company: 'ACME',
      nif: '123456789',
    });
  });

  it('returns a new object', () => {
    const source = { ...address };
    const copy = copyAddress(source, emptyAddressForm());
    copy.city = 'Faro';
    expect(source.city).toBe('Lisboa');
  });
});

describe('addressFormFromAddress', () => {
  it('fills missing optional fields with empty strings', () => {
    expect(
      addressFormFromAddress({
        firstName: 'A',
        lastName: 'B',
        line1: 'L',
        postalCode: 'P',
        city: 'C',
        country: 'PT',
      })
    ).toEqual({
      firstName: 'A',
      lastName: 'B',
      line1: 'L',
      line2: '',
      postalCode: 'P',
      city: 'C',
      country: 'PT',
      phone: '',
      company: '',
      nif: '',
    });
  });

  it('null gives an empty address', () => {
    expect(addressFormFromAddress(null)).toEqual(emptyAddressForm());
  });
});

describe('addLine', () => {
  it('appends a new variant with quantity 1', () => {
    expect(addLine([], variant())).toEqual([
      {
        variantId: 7,
        name: 'Tee',
        option: 'M',
        sku: 'TEE-M',
        unitPrice: 2000,
        stock: 5,
        imageUrl: null,
        quantity: 1,
      },
    ]);
  });

  it('increments the quantity of a variant already in the lines', () => {
    const lines = addLine(addLine([], variant()), variant());
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
  });

  it('does not add a variant without stock', () => {
    const lines: OrderLineDraft[] = [];
    expect(addLine(lines, variant({ stock: 0 }))).toBe(lines);
  });
});

describe('validateOrderForm', () => {
  it('accepts a complete form', () => {
    expect(validateOrderForm(validForm())).toEqual([]);
  });

  it('flags the customer, locale, address, lines and shipping', () => {
    const errors = validateOrderForm({ ...emptyOrderForm(''), billingSameAsShipping: false });
    const paths = errors.map((e) => `${e.path}:${e.code}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'customer.firstName:required',
        'customer.lastName:required',
        'customer.email:required',
        'locale:required',
        'shippingAddress.firstName:required',
        'shippingAddress.line1:required',
        'shippingAddress.postalCode:required',
        'shippingAddress.city:required',
        'shippingAddress.country:required',
        'billingAddress.lastName:required',
        'lines:required',
        'shipping:required',
      ])
    );
  });

  it('skips the billing address when it is the same as shipping', () => {
    const errors = validateOrderForm({ ...validForm(), billingSameAsShipping: true });
    expect(errors.some((e) => e.path.startsWith('billingAddress'))).toBe(false);
  });

  it('flags an invalid email', () => {
    const form = validForm();
    form.customer.email = 'nope';
    expect(validateOrderForm(form)).toEqual([{ path: 'customer.email', code: 'invalid_email' }]);
  });

  it('flags an invalid quantity per line', () => {
    const form = { ...validForm(), lines: [line(), line({ variantId: 2, quantity: 0 })] };
    expect(validateOrderForm(form)).toEqual([{ path: 'lines.1.quantity', code: 'INVALID_QUANTITY' }]);
  });
});

describe('buildCreateOrderInput', () => {
  it('trims, drops empty optionals, copies shipping into billing and sends the key', () => {
    const form = validForm();
    form.customer.firstName = ' Ana ';
    form.billingAddress = { ...emptyAddressForm(), company: 'ACME', nif: '123' };
    form.notes = '';
    const input = buildCreateOrderInput(form, 'key-1');
    expect(input).toEqual({
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com' },
      shippingAddress: {
        firstName: 'Ana',
        lastName: 'Silva',
        line1: 'Rua A 1',
        postalCode: '1000-001',
        city: 'Lisboa',
        country: 'PT',
      },
      billingAddress: {
        firstName: 'Ana',
        lastName: 'Silva',
        line1: 'Rua A 1',
        postalCode: '1000-001',
        city: 'Lisboa',
        country: 'PT',
        company: 'ACME',
        nif: '123',
      },
      locale: 'pt',
      lines: [{ variantId: 1, quantity: 1 }],
      shipping: { providerId: 'manual', serviceId: '1' },
      idempotencyKey: 'key-1',
    });
  });

  it('uses the billing address when it differs', () => {
    const form = { ...validForm(), billingSameAsShipping: false };
    form.billingAddress = { ...address, city: 'Porto' };
    expect(buildCreateOrderInput(form, 'k').billingAddress.city).toBe('Porto');
  });
});

describe('toOrderErrorMap', () => {
  it('keeps the first code per path', () => {
    expect(
      toOrderErrorMap(
        [
          { path: 'lines.0.quantity', code: 'INSUFFICIENT_STOCK' },
          { path: 'lines.0.quantity', code: 'INVALID_QUANTITY' },
          { path: 'shipping', code: 'SHIPPING_UNAVAILABLE' },
        ],
        false
      )
    ).toEqual({ 'lines.0.quantity': 'INSUFFICIENT_STOCK', shipping: 'SHIPPING_UNAVAILABLE' });
  });

  it('moves billing errors onto shipping when billing is the same as shipping', () => {
    expect(
      toOrderErrorMap(
        [
          { path: 'shippingAddress.city', code: 'required' },
          { path: 'billingAddress.city', code: 'required' },
          { path: 'billingAddress.line1', code: 'required' },
        ],
        true
      )
    ).toEqual({ 'shippingAddress.city': 'required', 'shippingAddress.line1': 'required' });
  });
});

describe('order form translations', () => {
  it.each([
    'required',
    'invalid_email',
    'invalid_country',
    'invalid',
    'INVALID_QUANTITY',
    'VARIANT_UNAVAILABLE',
    'INSUFFICIENT_STOCK',
    'SHIPPING_UNAVAILABLE',
  ])('%s is translated in en and pt', (code) => {
    const key = `littlebox-strapi-suite.ecommerce.orders.errors.${code}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });

  it('every orders key in en exists in pt and vice versa', () => {
    const keys = (o: Record<string, string>) =>
      Object.keys(o).filter((k) => k.startsWith('littlebox-strapi-suite.ecommerce.orders.')).sort();
    expect(keys(pt)).toEqual(keys(en));
  });
});

describe('promotion codes', () => {
  it('normalizePromotionCodes trims, upper-cases and drops blanks and repeats', () => {
    expect(normalizePromotionCodes([' verao20 ', 'VERAO20', '', 'frete'])).toEqual(['VERAO20', 'FRETE']);
  });

  it('addPromotionCode adds a normalized code, refusing blanks, repeats and a sixth code', () => {
    expect(addPromotionCode([], ' verao20 ')).toEqual({ codes: ['VERAO20'], error: null });
    expect(addPromotionCode(['VERAO20'], 'verao20')).toEqual({ codes: ['VERAO20'], error: 'duplicate' });
    expect(addPromotionCode(['A'], '  ')).toEqual({ codes: ['A'], error: 'required' });
    expect(addPromotionCode(['A', 'B', 'C', 'D', 'E'], 'F')).toEqual({
      codes: ['A', 'B', 'C', 'D', 'E'],
      error: 'too_many',
    });
  });

  it('buildCreateOrderInput sends the normalized codes without repeats', () => {
    const form = { ...validForm(), promotionCodes: ['verao20', 'VERAO20', 'Frete'] };
    expect(buildCreateOrderInput(form, 'k').promotionCodes).toEqual(['VERAO20', 'FRETE']);
    expect('promotionCodes' in buildCreateOrderInput(validForm(), 'k')).toBe(false);
  });

  it('buildCreateOrderInput adds expectedTotal and giftChoices from the quote (third argument) only', () => {
    const form = { ...validForm(), promotionCodes: ['VERAO20'] };
    const input = buildCreateOrderInput(form, 'k', { expectedTotal: 11700, giftChoices: { 4: 31 } });
    expect(input.expectedTotal).toBe(11700);
    expect(input.giftChoices).toEqual({ 4: 31 });
    const without = buildCreateOrderInput(form, 'k');
    expect('expectedTotal' in without).toBe(false);
    expect('giftChoices' in without).toBe(false);
  });
});

describe('order quote', () => {
  const quote = (over: Partial<OrderQuote> = {}): OrderQuote => ({
    lines: [
      { sourceIndex: 0, variantId: 1, productId: 10, unitPrice: 1250, quantity: 2, unitDiscount: 0, manualDiscountPercent: null, isGift: false, refs: [], sku: 'MUG', name: 'Mug', option: null, imageUrl: null, tax: 23 },
      {
        sourceIndex: null,
        variantId: 31,
        productId: 30,
        unitPrice: 300,
        quantity: 1,
        unitDiscount: 300,
        manualDiscountPercent: null,
        isGift: true,
        refs: [{ promotionId: 4, benefitIndex: 0, amount: 300 }],
        sku: 'SOCK-B',
        name: 'Socks',
        option: 'Blue',
        imageUrl: null,
        tax: 23,
      },
    ],
    promotions: [
      {
        promotionId: 4,
        version: 1,
        name: 'Gift',
        displayName: {},
        code: null,
        method: 'AUTOMATIC',
        classes: ['PRODUCT_DISCOUNT'],
        amount: 300,
        benefits: [
          {
            index: 0,
            type: 'BUY_X_GET_Y',
            class: 'PRODUCT_DISCOUNT',
            amount: 300,
            params: {
              type: 'BUY_X_GET_Y',
              buy: { target: { productIds: [10], variantIds: [] }, quantity: 2, minAmount: null },
              get: { mode: 'GIFT', variantIds: [30, 31], quantity: 1 },
              reward: { kind: 'FREE' },
            },
          },
        ],
        snapshot: {} as any,
      },
    ],
    codes: [],
    rejected: [],
    totals: {
      itemsOriginal: 2800,
      productDiscount: 300,
      subtotal: 2500,
      orderDiscount: 0,
      shippingOriginal: 500,
      shippingDiscount: 0,
      shippingTotal: 500,
      total: 3000,
      totalDiscount: 300,
    },
    shippingOption: null,
    exhaustive: true,
    giftOptions: [
      {
        promotionId: 4,
        benefitIndex: 0,
        quantity: 1,
        selectedVariantId: 31,
        variants: [
          { variantId: 30, sku: 'SOCK-R', name: 'Socks', option: 'Red', imageUrl: null, available: true },
          { variantId: 31, sku: 'SOCK-B', name: 'Socks', option: 'Blue', imageUrl: null, available: true },
        ],
      },
    ],
    ...over,
  });

  it('buildQuoteInput sends lines, locale, e-mail, codes, gift choices and the shipping destination', () => {
    const form = { ...validForm(), promotionCodes: ['verao20'] };
    form.shippingAddress.postalCode = ' 1000-001 ';
    expect(buildQuoteInput(form, { 4: 31 })).toEqual({
      lines: [{ variantId: 1, quantity: 1 }],
      locale: 'pt',
      email: 'ana@example.com',
      promotionCodes: ['VERAO20'],
      giftChoices: { 4: 31 },
      shipping: { country: 'PT', postalCode: '1000-001', providerId: 'manual', serviceId: '1' },
    });
  });

  it('buildQuoteInput leaves out shipping without a method or country, and an invalid e-mail', () => {
    const form = { ...validForm(), shipping: null };
    form.customer.email = 'nope';
    const input = buildQuoteInput(form, {});
    expect(input.shipping).toBeNull();
    expect(input.email).toBeNull();
    expect(input.promotionCodes).toEqual([]);
  });

  it('giftChoicesFromQuote reads the gift variant of each promotion that offers several', () => {
    expect(giftChoicesFromQuote(quote())).toEqual({ 4: 31 });
    const single = quote();
    single.giftOptions[0].variants = single.giftOptions[0].variants.slice(1);
    expect(giftChoicesFromQuote(single)).toEqual({});
  });

  it('giftSelectors lists the choosable gifts with the names and the variant in the quote', () => {
    const q = quote();
    expect(giftSelectors(q)).toEqual([
      { promotionId: 4, benefitIndex: 0, variants: q.giftOptions[0].variants, selected: 31 },
    ]);
    expect(giftSelectors(q)[0].variants.map((v) => [v.name, v.option])).toEqual([
      ['Socks', 'Red'],
      ['Socks', 'Blue'],
    ]);
  });

  it('giftSelectors reads giftOptions, not the promotion params: one variant → no selector', () => {
    const q = quote();
    q.giftOptions[0].variants = q.giftOptions[0].variants.slice(0, 1);
    expect(giftSelectors(q)).toEqual([]);
    // The params still list two variants: the selector follows giftOptions only.
    expect((q.promotions[0].benefits[0].params as any).get.variantIds).toEqual([30, 31]);
  });

  it('giftSelectors keeps two GIFT benefits of one promotion apart (promotionId + benefitIndex)', () => {
    const base = quote();
    const second = {
      promotionId: 4,
      benefitIndex: 1,
      quantity: 2,
      selectedVariantId: null,
      variants: [
        { variantId: 50, sku: 'CAP-R', name: 'Cap', option: 'Red', imageUrl: null, available: true },
        { variantId: 51, sku: 'CAP-B', name: 'Cap', option: 'Blue', imageUrl: null, available: false },
      ],
    };
    const q = quote({ giftOptions: [...base.giftOptions, second] });
    expect(giftSelectors(q).map((s) => [s.promotionId, s.benefitIndex, s.selected])).toEqual([
      [4, 0, 31],
      [4, 1, null],
    ]);
    expect(giftSelectors(q)[1].variants.map((v) => v.variantId)).toEqual([50, 51]);
    expect(giftChoicesFromQuote(q)).toEqual({ 4: 31 });
  });

  it('createOrderConflict recognises the promotion conflicts of create', () => {
    const err = (status: number, code: string) => ({
      response: { data: { error: { status, details: { code, errors: [{ path: 'x', code }] } } } },
    });
    expect(createOrderConflict(err(409, 'TOTAL_CHANGED'))).toBe('TOTAL_CHANGED');
    expect(createOrderConflict(err(409, 'PROMOTION_UNAVAILABLE'))).toBe('PROMOTION_UNAVAILABLE');
    expect(
      createOrderConflict({
        response: {
          data: {
            error: {
              details: {
                code: 'required',
                errors: [
                  { path: 'customer.email', code: 'required' },
                  { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID' },
                ],
              },
            },
          },
        },
      })
    ).toBe('PROMOTION_CODE_INVALID');
    expect(createOrderConflict(err(400, 'INSUFFICIENT_STOCK'))).toBeNull();
    expect(createOrderConflict(new Error('x'))).toBeNull();
  });

  it('has en + pt labels for the quote panel', () => {
    [
      'ecommerce.orders.quote.codes',
      'ecommerce.orders.quote.apply',
      'ecommerce.orders.quote.removeCode',
      'ecommerce.orders.quote.codeErrors.duplicate',
      'ecommerce.orders.quote.codeErrors.too_many',
      'ecommerce.orders.quote.codeErrors.required',
      'ecommerce.orders.quote.gift',
      'ecommerce.orders.quote.giftUnavailable',
      'ecommerce.orders.quote.error',
      'ecommerce.orders.quote.loading',
      'ecommerce.orders.quote.awaitingShipping',
      'ecommerce.orders.quote.nonExhaustive',
      'ecommerce.orders.quote.totalChanged',
      'ecommerce.orders.errors.TOTAL_CHANGED',
      'ecommerce.orders.errors.PROMOTION_UNAVAILABLE',
      'ecommerce.orders.errors.PROMOTION_CODE_INVALID',
    ].forEach((k) => {
      const key = `littlebox-strapi-suite.${k}`;
      expect(en[key], k).toEqual(expect.any(String));
      expect(pt[key], k).toEqual(expect.any(String));
    });
  });
});

describe('promotion code rules (fix round 1)', () => {
  it('refuses a code longer than 40 characters (too_long)', () => {
    expect(addPromotionCode([], 'A'.repeat(41))).toEqual({ codes: [], error: 'too_long' });
    expect(addPromotionCode([], 'A'.repeat(40))).toEqual({ codes: ['A'.repeat(40)], error: null });
  });

  it('refuses a code outside the server charset or shorter than 3 (invalid_format)', () => {
    expect(addPromotionCode([], 'VER ÃO')).toEqual({ codes: [], error: 'invalid_format' });
    expect(addPromotionCode([], 'ab')).toEqual({ codes: [], error: 'invalid_format' });
    expect(addPromotionCode([], 'summer_25-off')).toEqual({ codes: ['SUMMER_25-OFF'], error: null });
  });

  it('has en + pt messages for the new refusals', () => {
    ['too_long', 'invalid_format'].forEach((k) => {
      const key = `littlebox-strapi-suite.ecommerce.orders.quote.codeErrors.${k}`;
      expect(en[key], k).toEqual(expect.any(String));
      expect(pt[key], k).toEqual(expect.any(String));
    });
  });
});

describe('pruneGiftChoices', () => {
  it('keeps only the choices of promotions with a gift selector in the quote', () => {
    const q = {
      lines: [
        { sourceIndex: null, variantId: 31, productId: 30, unitPrice: 300, quantity: 1, unitDiscount: 300, isGift: true, refs: [{ promotionId: 4, benefitIndex: 0, amount: 300 }], sku: 'S', name: 'Socks', option: null, imageUrl: null },
      ],
      promotions: [
        {
          promotionId: 4,
          benefits: [
            {
              index: 0,
              type: 'BUY_X_GET_Y',
              class: 'PRODUCT_DISCOUNT',
              amount: 300,
              params: {
                type: 'BUY_X_GET_Y',
                buy: { target: { productIds: [10], variantIds: [] }, quantity: 2, minAmount: null },
                get: { mode: 'GIFT', variantIds: [30, 31], quantity: 1 },
                reward: { kind: 'FREE' },
              },
            },
          ],
        },
      ],
      giftOptions: [
        {
          promotionId: 4,
          benefitIndex: 0,
          quantity: 1,
          selectedVariantId: 31,
          variants: [
            { variantId: 30, sku: 'R', name: 'Socks', option: null, imageUrl: null, available: true },
            { variantId: 31, sku: 'S', name: 'Socks', option: null, imageUrl: null, available: true },
          ],
        },
      ],
    } as unknown as OrderQuote;
    const choices = { 4: 30, 9: 99 };
    expect(pruneGiftChoices(choices, q)).toEqual({ 4: 30 });
    // Unchanged choices keep their identity (no re-quote loop).
    const kept = { 4: 30 };
    expect(pruneGiftChoices(kept, q)).toBe(kept);
  });
});

describe('manual line discount on a new order (spec 4.1)', () => {
  it('the line subtotal uses the discounted unit price', () => {
    expect(lineSubtotal(line({ unitPrice: 2000, quantity: 2, discount: '10' }))).toBe(3600);
    expect(lineUnitNet(line({ unitPrice: 2000, discount: '12,5' }))).toBe(1750);
    expect(lineUnitNet(line({ unitPrice: 2000, discount: 'x' }))).toBe(2000);
  });

  it('flags an invalid percent on its line', () => {
    const form = { ...validForm(), lines: [line(), line({ variantId: 2, discount: '101' })] };
    expect(validateOrderForm(form)).toEqual([{ path: 'lines.1.discountPercent', code: 'INVALID_PERCENT' }]);
  });

  it('create and quote send the percent only when one is set', () => {
    const form = { ...validForm(), lines: [line({ discount: '15' }), line({ variantId: 2, discount: '' })] };
    expect(buildCreateOrderInput(form, 'k').lines).toEqual([
      { variantId: 1, quantity: 1, discountPercent: 15 },
      { variantId: 2, quantity: 1 },
    ]);
    expect(buildQuoteInput(form, {}).lines).toEqual([
      { variantId: 1, quantity: 1, discountPercent: 15 },
      { variantId: 2, quantity: 1 },
    ]);
  });
});
