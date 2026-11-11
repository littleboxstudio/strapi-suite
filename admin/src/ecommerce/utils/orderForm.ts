import { isEmail } from './settingsForm';
import type { Address, CreateOrderInput, FieldError, VariantSearchResult } from '../orderTypes';

/** Every address field as a string; shipping ignores `company` and `nif` in the UI. */
export type AddressForm = {
  firstName: string;
  lastName: string;
  company: string;
  nif: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
};

export type OrderLineDraft = {
  variantId: number;
  name: string;
  option: string | null;
  sku: string;
  unitPrice: number;
  stock: number;
  imageUrl: string | null;
  quantity: number;
};

export type OrderForm = {
  customer: { firstName: string; lastName: string; email: string; phone: string };
  locale: string;
  shippingAddress: AddressForm;
  billingAddress: AddressForm;
  billingSameAsShipping: boolean;
  lines: OrderLineDraft[];
  shipping: { providerId: string; serviceId: string } | null;
  notes: string;
};

/** First error code per path (`customer.email`, `lines.0.quantity`, `shipping`, …). */
export type OrderErrorMap = Record<string, string>;

export const ADDRESS_REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'line1',
  'postalCode',
  'city',
  'country',
] as const;

const ADDRESS_OPTIONAL_FIELDS = ['company', 'nif', 'line2', 'phone'] as const;

export function emptyAddressForm(): AddressForm {
  return {
    firstName: '',
    lastName: '',
    company: '',
    nif: '',
    line1: '',
    line2: '',
    postalCode: '',
    city: '',
    country: '',
    phone: '',
  };
}

export function emptyOrderForm(locale: string): OrderForm {
  return {
    customer: { firstName: '', lastName: '', email: '', phone: '' },
    locale,
    shippingAddress: emptyAddressForm(),
    billingAddress: emptyAddressForm(),
    billingSameAsShipping: true,
    lines: [],
    shipping: null,
    notes: '',
  };
}

export function addressFormFromAddress(a: Partial<Address> | null | undefined): AddressForm {
  const empty = emptyAddressForm();
  if (!a) return empty;
  const out = { ...empty };
  (Object.keys(empty) as (keyof AddressForm)[]).forEach((k) => {
    const v = a[k];
    out[k] = typeof v === 'string' ? v : '';
  });
  return out;
}

/** `source` copied over `target`, keeping the billing-only `company` and `nif` of `target`. */
export function copyAddress(source: AddressForm, target: AddressForm): AddressForm {
  return { ...source, company: target.company, nif: target.nif };
}

const validQuantity = (q: number) => Number.isSafeInteger(q) && q >= 1;

export function lineSubtotal(line: OrderLineDraft): number {
  return validQuantity(line.quantity) ? line.unitPrice * line.quantity : 0;
}

/** Local preview only: the server recomputes every amount when the order is created. */
export function sumPreviewTotals(
  lines: OrderLineDraft[],
  shippingPrice: number | null | undefined
): { subtotal: number; shipping: number; total: number } {
  const subtotal = lines.reduce((sum, l) => sum + lineSubtotal(l), 0);
  const shipping = shippingPrice ?? 0;
  return { subtotal, shipping, total: subtotal + shipping };
}

/** Adds a variant (quantity 1) or bumps the line that already has it; without stock nothing changes. */
export function addLine(lines: OrderLineDraft[], v: VariantSearchResult): OrderLineDraft[] {
  if (v.stock <= 0) return lines;
  const index = lines.findIndex((l) => l.variantId === v.variantId);
  if (index !== -1) {
    return lines.map((l, i) => (i === index ? { ...l, quantity: l.quantity + 1 } : l));
  }
  return [
    ...lines,
    {
      variantId: v.variantId,
      name: v.name,
      option: v.option,
      sku: v.sku,
      unitPrice: v.price,
      stock: v.stock,
      imageUrl: v.imageUrl,
      quantity: 1,
    },
  ];
}

function validateAddress(a: AddressForm, path: string, errors: FieldError[]) {
  ADDRESS_REQUIRED_FIELDS.forEach((f) => {
    if (!a[f].trim()) errors.push({ path: `${path}.${f}`, code: 'required' });
  });
}

/** Mirrors the server rules so obvious mistakes are flagged without a round trip. */
export function validateOrderForm(form: OrderForm): FieldError[] {
  const errors: FieldError[] = [];
  const c = form.customer;
  if (!c.firstName.trim()) errors.push({ path: 'customer.firstName', code: 'required' });
  if (!c.lastName.trim()) errors.push({ path: 'customer.lastName', code: 'required' });
  const email = c.email.trim();
  if (!email) errors.push({ path: 'customer.email', code: 'required' });
  else if (!isEmail(email)) errors.push({ path: 'customer.email', code: 'invalid_email' });
  if (!form.locale.trim()) errors.push({ path: 'locale', code: 'required' });
  validateAddress(form.shippingAddress, 'shippingAddress', errors);
  if (!form.billingSameAsShipping) validateAddress(form.billingAddress, 'billingAddress', errors);
  if (!form.lines.length) errors.push({ path: 'lines', code: 'required' });
  form.lines.forEach((l, i) => {
    if (!validQuantity(l.quantity)) errors.push({ path: `lines.${i}.quantity`, code: 'INVALID_QUANTITY' });
  });
  if (!form.shipping) errors.push({ path: 'shipping', code: 'required' });
  return errors;
}

function toAddress(a: AddressForm, withBillingFields: boolean): Address {
  const out: Record<string, string> = {};
  ADDRESS_REQUIRED_FIELDS.forEach((f) => {
    out[f] = a[f].trim();
  });
  out.country = out.country.toUpperCase();
  ADDRESS_OPTIONAL_FIELDS.forEach((f) => {
    if (!withBillingFields && (f === 'company' || f === 'nif')) return;
    const v = a[f].trim();
    if (v) out[f] = v;
  });
  return out as unknown as Address;
}

export function buildCreateOrderInput(form: OrderForm, idempotencyKey: string): CreateOrderInput {
  const phone = form.customer.phone.trim();
  const billing = form.billingSameAsShipping
    ? copyAddress(form.shippingAddress, form.billingAddress)
    : form.billingAddress;
  const notes = form.notes.trim();
  return {
    customer: {
      firstName: form.customer.firstName.trim(),
      lastName: form.customer.lastName.trim(),
      email: form.customer.email.trim(),
      ...(phone ? { phone } : {}),
    },
    shippingAddress: toAddress(form.shippingAddress, false),
    billingAddress: toAddress(billing, true),
    locale: form.locale,
    lines: form.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shipping: form.shipping ?? { providerId: '', serviceId: '' },
    ...(notes ? { notes } : {}),
    idempotencyKey,
  };
}

/**
 * First code per path. With the billing address hidden (same as shipping), its errors are shown
 * on the matching shipping field.
 */
export function toOrderErrorMap(errors: FieldError[], billingSameAsShipping: boolean): OrderErrorMap {
  const map: OrderErrorMap = {};
  errors.forEach(({ path, code }) => {
    const key =
      billingSameAsShipping && path.startsWith('billingAddress.')
        ? `shippingAddress.${path.slice('billingAddress.'.length)}`
        : path;
    if (!(key in map)) map[key] = code;
  });
  return map;
}
