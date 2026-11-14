/**
 * Pure invoicing domain helpers (design 4.4; no Strapi imports): invoice lines as stored, the
 * invoiced customer, payment method names and issue dates. Money is integer cents. What can be
 * invoiced or credited lives in `invoiceSelection` and `creditNotes` (plan 11).
 */
import type { Address } from './orders';

export type InvoiceLine = {
  orderLineId: number | null;
  kind: 'ITEM' | 'SHIPPING';
  sku: string;
  name: string;
  quantity: number;
  /** Cents, VAT included. */
  total: number;
  /**
   * Cents, VAT included, before discounts (line discount and its share of the order discounts),
   * so the document can show the discount. Absent on older lines: no discount shown.
   */
  grossTotal?: number;
  tax: number;
  partial: boolean;
  /** SHIPPING lines of selection invoices: the shipping line they invoice. */
  shippingLineId?: number | null;
};

export type InvoiceCustomer = {
  name: string;
  nif: string | null;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
};

export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** A finite number, or 0. */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The stored `lines` JSON of an invoice row (`{ lines: [...] }`), malformed entries dropped. */
export const readInvoiceLines = (raw: unknown): InvoiceLine[] => {
  const list = isObject(raw) ? raw.lines : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(isObject).map((l) => {
    const shippingLineId = l.shippingLineId == null ? null : Number(l.shippingLineId);
    const grossTotal = Number(l.grossTotal);
    return {
      orderLineId: l.orderLineId == null ? null : Number(l.orderLineId),
      kind: l.kind === 'SHIPPING' ? 'SHIPPING' : 'ITEM',
      sku: typeof l.sku === 'string' ? l.sku : '',
      name: typeof l.name === 'string' ? l.name : '',
      quantity: num(l.quantity),
      total: num(l.total),
      ...(l.grossTotal != null && Number.isInteger(grossTotal) && grossTotal > 0 ? { grossTotal } : {}),
      tax: num(l.tax),
      partial: l.partial === true,
      ...(Number.isInteger(shippingLineId) ? { shippingLineId } : {}),
    };
  });
};

/**
 * `line` with `total = value`: its `grossTotal`, if any, scales by the same ratio, so a part of
 * the line keeps its discount percentage.
 */
export const withTotal = (line: InvoiceLine, value: number): InvoiceLine => {
  const { grossTotal, ...rest } = line;
  if (grossTotal == null || !(line.total > 0)) return { ...rest, total: value };
  return { ...rest, total: value, grossTotal: Math.round((grossTotal * value) / line.total) };
};

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/** Never invents a NIF: `nif` is null when the billing address has none. */
export const invoiceCustomer = (
  billing: Address | null,
  customer: { firstName: string; lastName: string; email: string }
): InvoiceCustomer => {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const person = billing && (str(billing.firstName) || str(billing.lastName)) ? billing : customer;
  const name =
    str(billing?.company) ||
    [str(person.firstName), str(person.lastName)].filter(Boolean).join(' ');
  return {
    name,
    nif: str(billing?.nif) || null,
    address: [str(billing?.line1), str(billing?.line2)].filter(Boolean).join(', '),
    postalCode: str(billing?.postalCode),
    city: str(billing?.city),
    country: str(billing?.country),
    email: str(customer.email),
  };
};

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

/** The billing payment method name of store-credit payments. */
export const STORE_CREDIT_METHOD_NAME = 'Crédito em carteira';

/** Longest payment method name sent to the billing provider (Moloni). */
const MAX_METHOD_NAME = 64;

/**
 * The billing payment method name of a payment: "Stripe", the store-credit name, or the manual
 * payment's trimmed label, capped at 64 characters ('' when it has none: the provider then uses
 * its configured method).
 */
export function paymentMethodName(method: string, methodLabel: unknown): string {
  if (method === 'STRIPE') return 'Stripe';
  if (method === 'STORE_CREDIT') return STORE_CREDIT_METHOD_NAME;
  return typeof methodLabel === 'string'
    ? methodLabel.trim().slice(0, MAX_METHOD_NAME).trim()
    : '';
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in the store time zone (UTC when the zone is invalid). */
export const issueDate = (now: Date, timeZone: string): string => {
  const format = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
};
