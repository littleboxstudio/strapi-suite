/**
 * Create order, redesign v2 (spec 2026-11-18-create-order-redesign-design): the sections are
 * tables filled through modals, the admin picks the promotions and codes, and the shipping is a
 * list of charges (the first one is the delivery method).
 */
import { isEmail } from './settingsForm';
import {
  ADDRESS_REQUIRED_FIELDS,
  addPromotionCode,
  addressFormFromAddress,
  normalizePromotionCodes,
  type AddressForm,
  type DraftShippingLine,
  type OrderErrorMap,
  type OrderForm,
  type PromotionCodeError,
} from './orderForm';
import { parseDiscountPercent } from './lineDiscount';
import type {
  ApplicablePromotion,
  ApplicablePromotionsInput,
  AppliedPromotion,
  CustomerLastAddresses,
  DiscountClass,
  OrderQuote,
  PickupSelection,
  PromotionCodeStatus,
  ShippingOption,
} from '../orderTypes';
import type { PromotionBenefit } from '../promotionTypes';

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim() !== '';

/** The customer table has a row as soon as one field is filled. */
export function hasCustomer(c: OrderForm['customer']): boolean {
  return [c.firstName, c.lastName, c.email, c.phone].some(filled);
}

/** An address table has a row as soon as one field is filled. */
export function hasAddress(a: AddressForm): boolean {
  return (Object.keys(a) as (keyof AddressForm)[]).some((k) => filled(a[k]));
}

/** The customer modal's own check, keyed by field (the server rules). */
export function customerFormErrors(c: OrderForm['customer']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!filled(c.firstName)) out.firstName = 'required';
  if (!filled(c.lastName)) out.lastName = 'required';
  const email = c.email.trim();
  if (!email) out.email = 'required';
  else if (!isEmail(email)) out.email = 'invalid_email';
  return out;
}

/** An address modal's own check: the required fields, keyed by field. */
export function addressFormErrors(a: AddressForm): Record<string, string> {
  const out: Record<string, string> = {};
  ADDRESS_REQUIRED_FIELDS.forEach((f) => {
    if (!filled(a[f])) out[f] = 'required';
  });
  return out;
}

/** The errors of a section (`customer.email` …) keyed by the field below it, for its modal. */
export function fieldErrors(errors: OrderErrorMap, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(errors).forEach(([path, code]) => {
    if (path.startsWith(`${prefix}.`)) out[path.slice(prefix.length + 1)] = code;
  });
  return out;
}

export type SectionError = { path: string; field: string | null; code: string };

/** The first error of a section (`customer`, `shippingAddress`, …): its own path or one below it. */
export function sectionError(errors: OrderErrorMap, prefix: string): SectionError | null {
  const path = Object.keys(errors).find((p) => p === prefix || p.startsWith(`${prefix}.`));
  if (!path) return null;
  return {
    path,
    field: path === prefix ? null : path.slice(prefix.length + 1),
    code: errors[path],
  };
}

/**
 * An existing customer was picked: their last addresses fill the tables, and an address they do not
 * have empties its table (another customer's address or NIF is never kept; the billing is never
 * assumed from the shipping).
 */
export function applyCustomerAddresses(form: OrderForm, last: CustomerLastAddresses): OrderForm {
  return {
    ...form,
    shippingAddress: addressFormFromAddress(last.shippingAddress ?? null),
    billingAddress: addressFormFromAddress(last.billingAddress ?? null),
    billingSameAsShipping: false,
  };
}

/** A shipping table line from the chosen option, the entered amount and the point or store. */
export function shippingLineFromOption(
  option: ShippingOption,
  amount: number,
  pickup: PickupSelection | null,
  key: string
): DraftShippingLine {
  return {
    key,
    providerId: option.providerId,
    serviceId: option.serviceId,
    name: option.name,
    amount,
    ...(option.requiresPickupPoint ? { requiresPickupPoint: true } : {}),
    pickup: option.requiresPickupPoint ? pickup : null,
  };
}

const SHIPPING_LINE_FIELDS = [
  '',
  '.providerId',
  '.serviceId',
  '.amount',
  '.pickupPointId',
  '.pickupPostalCode',
];

/** The first server error of shipping line `index`. */
export function shippingLineError(errors: OrderErrorMap, index: number): string | undefined {
  return SHIPPING_LINE_FIELDS.map((f) => errors[`shippingLines.${index}${f}`]).find(
    (c) => c !== undefined
  );
}

const QUOTE_ERROR_PREFIXES = ['manualDiscounts', 'shippingLines', 'destination', 'promotionIds'];

/** Errors the quote answers for: each new quote replaces them. */
export function isQuoteErrorPath(path: string): boolean {
  return QUOTE_ERROR_PREFIXES.some((p) => path === p || path.startsWith(`${p}.`));
}

/** Body of `orders/applicable-promotions`: the cart as the quote prices it. */
export function applicablePromotionsInput(
  form: OrderForm,
  giftChoices: Record<number, number>
): ApplicablePromotionsInput {
  const email = form.customer.email.trim();
  return {
    lines: form.lines.map((l) => {
      const parsed = parseDiscountPercent(l.discount ?? '');
      return {
        variantId: l.variantId,
        quantity: l.quantity,
        ...(parsed.ok && parsed.value !== null ? { discountPercent: parsed.value } : {}),
      };
    }),
    locale: form.locale,
    email: email && isEmail(email) ? email : null,
    promotionCodes: normalizePromotionCodes(form.promotionCodes),
    giftChoices: { ...giftChoices },
    shippingLines: form.shippingLines.map((l) => ({ amount: l.amount })),
  };
}

export type ApplyDiscountRow = {
  id: number;
  name: string;
  displayName: Record<string, string>;
  classes: DiscountClass[];
  benefits: PromotionBenefit[];
  /** What it gives in the best combination; null for a selected one no longer listed. */
  amount: number | null;
  /** False: selected before, but it no longer applies to the cart. */
  listed: boolean;
};

/**
 * Apply discount's rows: the applicable promotions, then the selected ones the list no longer
 * has (named from the last quote, else `#id`), so they can be unselected.
 */
export function applyDiscountRows(
  applicable: ApplicablePromotion[],
  selected: number[],
  known: Pick<AppliedPromotion, 'promotionId' | 'name' | 'displayName' | 'classes' | 'benefits'>[]
): ApplyDiscountRow[] {
  const listed: ApplyDiscountRow[] = applicable.map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.displayName ?? {},
    classes: p.classes,
    benefits: p.benefits,
    amount: p.amount,
    listed: true,
  }));
  const missing: ApplyDiscountRow[] = selected
    .filter((id) => !applicable.some((p) => p.id === id))
    .map((id) => {
      const p = known.find((k) => k.promotionId === id);
      return {
        id,
        name: p?.name ?? `#${id}`,
        displayName: p?.displayName ?? {},
        classes: p?.classes ?? [],
        benefits: (p?.benefits ?? []).map((b) => b.params),
        amount: null,
        listed: false,
      };
    });
  return [...listed, ...missing];
}

/**
 * A duplicate's pre-selected promotions checked against the applicable ones: those still returned
 * stay selected (in order), the others are dropped and named in a notice.
 */
export function keptPromotionIds(
  selected: number[],
  applicable: Pick<ApplicablePromotion, 'id'>[]
): { kept: number[]; dropped: number[] } {
  const ids = new Set(applicable.map((p) => p.id));
  return {
    kept: selected.filter((id) => ids.has(id)),
    dropped: selected.filter((id) => !ids.has(id)),
  };
}

/** A gift line's row key: unique per promotion benefit and variant. */
export function giftLineKey(line: Pick<OrderQuote['lines'][number], 'variantId' | 'refs'>): string {
  const refs = line.refs.map((r) => `${r.promotionId}.${r.benefitIndex}`).join('_');
  return `gift-${refs}-${line.variantId}`;
}

/** Adds `id`, or removes it when it is there. */
export function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Adds the codes picked in Add code, one by one; the refused ones say why. */
export function addPromotionCodes(
  codes: string[],
  picked: string[]
): { codes: string[]; refused: { code: string; error: PromotionCodeError }[] } {
  let next = codes;
  const refused: { code: string; error: PromotionCodeError }[] = [];
  picked.forEach((raw) => {
    const result = addPromotionCode(next, raw);
    if (result.error) refused.push({ code: raw.trim().toUpperCase(), error: result.error });
    else next = result.codes;
  });
  return { codes: next, refused };
}

/** The added codes the quote did not apply (an applied one is a promotion row), with its status. */
export function unappliedCodes(
  codes: string[],
  quote: Pick<OrderQuote, 'codes'> | null
): { code: string; status: PromotionCodeStatus | null }[] {
  return codes
    .map((code) => ({ code, status: quote?.codes.find((c) => c.code === code)?.status ?? null }))
    .filter((c) => c.status !== 'APPLIED');
}
