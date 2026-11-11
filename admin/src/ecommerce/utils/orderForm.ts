import { isEmail } from './settingsForm';
import {
  MAX_PROMOTION_CODES,
  type Address,
  type CreateOrderInput,
  type FieldError,
  type OrderQuote,
  type OrderQuoteInput,
  type QuoteGiftOption,
  type VariantSearchResult,
} from '../orderTypes';

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
  /** Promotion codes typed by the admin (shown as tags). */
  promotionCodes: string[];
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
    promotionCodes: [],
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

export function toAddress(a: AddressForm, withBillingFields: boolean): Address {
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

/** What the last quote decided: the total shown to the admin and the gift variants it priced. */
export type QuoteDecision = { expectedTotal: number; giftChoices: Record<number, number> };

export function buildCreateOrderInput(
  form: OrderForm,
  idempotencyKey: string,
  quote?: QuoteDecision
): CreateOrderInput {
  const phone = form.customer.phone.trim();
  const codes = normalizePromotionCodes(form.promotionCodes ?? []);
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
    ...(codes.length ? { promotionCodes: codes } : {}),
    ...(quote ? { expectedTotal: quote.expectedTotal, giftChoices: { ...quote.giftChoices } } : {}),
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

// ---------------------------------------------------------------------------
// Promotion codes and the order quote (promotions plan 6)
// ---------------------------------------------------------------------------

/** Codes as the server matches them: trimmed, upper case, no blanks, no repeats (order kept). */
export function normalizePromotionCodes(codes: string[]): string[] {
  const out: string[] = [];
  codes.forEach((raw) => {
    const code = (raw ?? '').trim().toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  });
  return out;
}

export type PromotionCodeError = 'required' | 'duplicate' | 'too_many' | 'too_long' | 'invalid_format';

/** Server limits: at most 40 characters (`too_long`), and promotion codes match this pattern. */
export const MAX_PROMOTION_CODE_LENGTH = 40;
const PROMOTION_CODE_RE = /^[A-Z0-9_-]{3,40}$/;

/** Adds one typed code to the tags; the list is unchanged when the code is refused. */
export function addPromotionCode(
  codes: string[],
  raw: string
): { codes: string[]; error: PromotionCodeError | null } {
  const code = (raw ?? '').trim().toUpperCase();
  if (!code) return { codes, error: 'required' };
  if (codes.includes(code)) return { codes, error: 'duplicate' };
  if (codes.length >= MAX_PROMOTION_CODES) return { codes, error: 'too_many' };
  if (code.length > MAX_PROMOTION_CODE_LENGTH) return { codes, error: 'too_long' };
  if (!PROMOTION_CODE_RE.test(code)) return { codes, error: 'invalid_format' };
  return { codes: [...codes, code], error: null };
}

/**
 * Body of `orders/quote`. The shipping destination is sent only once a country and a shipping
 * method are chosen; an e-mail only when it looks valid (it decides e-mail eligibility).
 */
export function buildQuoteInput(form: OrderForm, giftChoices: Record<number, number>): OrderQuoteInput {
  const email = form.customer.email.trim();
  const country = form.shippingAddress.country.trim().toUpperCase();
  const postalCode = form.shippingAddress.postalCode.trim();
  return {
    lines: form.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    locale: form.locale,
    email: email && isEmail(email) ? email : null,
    promotionCodes: normalizePromotionCodes(form.promotionCodes ?? []),
    giftChoices: { ...giftChoices },
    shipping:
      country && form.shipping
        ? {
            country,
            ...(postalCode ? { postalCode } : {}),
            providerId: form.shipping.providerId,
            serviceId: form.shipping.serviceId,
          }
        : null,
  };
}

/** A gift choice, identified by `promotionId` + `benefitIndex`, with the names from the quote. */
export type GiftSelector = {
  promotionId: number;
  benefitIndex: number;
  variants: QuoteGiftOption['variants'];
  selected: number | null;
};

/** Gift benefits of the applied promotions (`quote.giftOptions`) offering several variants. */
export function giftSelectors(quote: OrderQuote): GiftSelector[] {
  return quote.giftOptions
    .filter((g) => g.variants.length >= 2)
    .map((g) => ({
      promotionId: g.promotionId,
      benefitIndex: g.benefitIndex,
      variants: g.variants,
      selected: g.selectedVariantId,
    }));
}

/**
 * The gift variant the quote priced for each promotion with a choice: sent with the order. The
 * server keys choices by promotion, so the first benefit of a promotion decides.
 */
export function giftChoicesFromQuote(quote: OrderQuote): Record<number, number> {
  const out: Record<number, number> = {};
  giftSelectors(quote).forEach((s) => {
    if (s.selected !== null && !(s.promotionId in out)) out[s.promotionId] = s.selected;
  });
  return out;
}

const CREATE_CONFLICTS = ['TOTAL_CHANGED', 'PROMOTION_UNAVAILABLE', 'PROMOTION_CODE_INVALID'] as const;
export type CreateOrderConflict = (typeof CREATE_CONFLICTS)[number];

/** A refused create the admin answers by re-quoting (the totals or a promotion changed). */
export function createOrderConflict(err: unknown): CreateOrderConflict | null {
  const details = (err as any)?.response?.data?.error?.details;
  const codes: unknown[] = [
    details?.code,
    ...(Array.isArray(details?.errors) ? details.errors.map((e: any) => e?.code) : []),
  ];
  return CREATE_CONFLICTS.find((c) => codes.includes(c)) ?? null;
}

/** The gift choices of promotions that still offer a choice in `quote`; the same object when nothing is dropped. */
export function pruneGiftChoices(
  choices: Record<number, number>,
  quote: OrderQuote
): Record<number, number> {
  const ids = new Set(giftSelectors(quote).map((s) => s.promotionId));
  const keys = Object.keys(choices).map(Number);
  if (keys.every((k) => ids.has(k))) return choices;
  const out: Record<number, number> = {};
  keys.forEach((k) => {
    if (ids.has(k)) out[k] = choices[k];
  });
  return out;
}
