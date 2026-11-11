import { describe, it, expect } from 'vitest';
import {
  addLine,
  addressFormFromAddress,
  buildCreateOrderInput,
  copyAddress,
  emptyAddressForm,
  emptyOrderForm,
  lineSubtotal,
  sumPreviewTotals,
  toOrderErrorMap,
  validateOrderForm,
  type OrderForm,
  type OrderLineDraft,
} from '../../../admin/src/ecommerce/utils/orderForm';
import type { VariantSearchResult } from '../../../admin/src/ecommerce/orderTypes';

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
