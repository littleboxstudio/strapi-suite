import { MAX_MONEY_CENTS, formatAmountInput, parseMoneyToCents } from './money';
import type { CreateShipmentInput, Order, OrderStatus, ShipmentView } from '../orderTypes';

/** Mirror the server limits. */
export const MAX_CARRIER_NAME = 120;
export const MAX_TRACKING_CODE = 255;
export const MAX_TRACKING_URL = 2000;
export const MAX_CANCEL_REASON = 500;

export type ShipMode = 'MANUAL' | 'CARRIER';
export type ShipLineDraft = { orderLineId: number; quantity: string };

export type ShipForm = {
  lines: ShipLineDraft[];
  mode: ShipMode;
  /** MANUAL only. */
  carrierName: string;
  trackingCode: string;
  trackingUrl: string;
  /** Decimal text in the admin's locale. */
  shippingCost: string;
  notifyCustomer: boolean;
};

/** Field path (`lines.<orderLineId>`, `lines`, `carrierName`, …) → error code. */
export type FormErrors = Record<string, string>;

/** True for an absolute http(s) URL of at most 2000 characters (never `javascript:` & co.). */
export function isHttpUrl(value: string): boolean {
  if (!value || value.length > MAX_TRACKING_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A whole number ≥ 0 typed in a quantity field; null otherwise. Blank counts as 0. */
export function parseQuantity(text: string): number | null {
  const s = text.trim();
  if (!s) return 0;
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

/** Lines with units left to ship, each defaulting to everything pending. */
export function defaultShipLines(lines: { id: number; pending: number }[]): ShipLineDraft[] {
  return lines.filter((l) => l.pending > 0).map((l) => ({ orderLineId: l.id, quantity: String(l.pending) }));
}

/** The order's shipping method belongs to a carrier (not the built-in manual methods). */
export function canShipByCarrier(shippingMethod: Record<string, unknown> | null | undefined): boolean {
  const providerId = shippingMethod?.providerId;
  return typeof providerId === 'string' && !!providerId && providerId !== 'manual';
}

export function emptyShipForm(
  order: Pick<Order, 'lines' | 'shipping'> & { shippingMethod: Record<string, unknown> | null },
  locale: string
): ShipForm {
  const name = order.shippingMethod?.name;
  return {
    lines: defaultShipLines(order.lines),
    mode: 'MANUAL',
    carrierName: typeof name === 'string' ? name.slice(0, MAX_CARRIER_NAME) : '',
    trackingCode: '',
    trackingUrl: '',
    shippingCost: formatAmountInput(order.shipping?.remainingCost ?? 0, locale),
    notifyCustomer: true,
  };
}

/** Checks the ship form (requirement 10.4): 0 ≤ quantity ≤ pending, at least one unit. */
export function validateShipForm(form: ShipForm, lines: { id: number; pending: number }[]): FormErrors {
  const errors: FormErrors = {};
  const pendingOf = new Map(lines.map((l) => [l.id, l.pending]));
  let units = 0;
  for (const line of form.lines) {
    const q = parseQuantity(line.quantity);
    if (q === null) errors[`lines.${line.orderLineId}`] = 'invalid_quantity';
    else if (q > (pendingOf.get(line.orderLineId) ?? 0)) errors[`lines.${line.orderLineId}`] = 'QUANTITY_EXCEEDS_PENDING';
    else units += q;
  }
  if (!units && !Object.keys(errors).length) errors.lines = 'required';

  if (form.mode === 'MANUAL') {
    const carrier = form.carrierName.trim();
    if (!carrier) errors.carrierName = 'required';
    else if (carrier.length > MAX_CARRIER_NAME) errors.carrierName = 'too_long';
    if (form.trackingCode.trim().length > MAX_TRACKING_CODE) errors.trackingCode = 'too_long';
    const url = form.trackingUrl.trim();
    if (url && !isHttpUrl(url)) errors.trackingUrl = 'invalid_url';
  }

  const cost = parseMoneyToCents(form.shippingCost);
  if (cost === null || cost < 0 || cost > MAX_MONEY_CENTS) errors.shippingCost = 'invalid_amount';
  return errors;
}

/** The request body of a form `validateShipForm` accepted. */
export function buildShipmentInput(form: ShipForm, idempotencyKey: string): CreateShipmentInput {
  const lines = form.lines
    .map((l) => ({ orderLineId: l.orderLineId, quantity: parseQuantity(l.quantity) ?? 0 }))
    .filter((l) => l.quantity > 0);
  let method: CreateShipmentInput['method'] = { mode: 'CARRIER' };
  if (form.mode === 'MANUAL') {
    const trackingCode = form.trackingCode.trim();
    const trackingUrl = form.trackingUrl.trim();
    method = {
      mode: 'MANUAL',
      carrierName: form.carrierName.trim(),
      ...(trackingCode ? { trackingCode } : {}),
      ...(trackingUrl ? { trackingUrl } : {}),
    };
  }
  return {
    lines,
    method,
    shippingCost: parseMoneyToCents(form.shippingCost) ?? 0,
    notifyCustomer: form.notifyCustomer,
    idempotencyKey,
  };
}

export function validateTrackingForm(form: { trackingCode: string; trackingUrl: string }): FormErrors {
  const errors: FormErrors = {};
  if (form.trackingCode.trim().length > MAX_TRACKING_CODE) errors.trackingCode = 'too_long';
  const url = form.trackingUrl.trim();
  if (url && !isHttpUrl(url)) errors.trackingUrl = 'invalid_url';
  return errors;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `now` as a local `YYYY-MM-DDTHH:mm` (a datetime-local input value). */
export function defaultDeliveredAtInput(now = new Date()): string {
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/** A datetime-local value as an ISO instant; null when it is not a real local date-time. */
export function deliveredAtInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])];
  const date = new Date(y, mo, d, h, mi);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return date.toISOString();
}

/**
 * The value to send for a delivery date: the real current time when the admin left the default
 * untouched (the input is truncated to the minute, which the server would refuse as earlier than a
 * shipment of the same minute); otherwise the typed value, or null when it is not valid.
 */
export function resolveDeliveredAt(value: string, defaultValue: string, now = new Date()): string | null {
  if (value === defaultValue) return now.toISOString();
  return deliveredAtInputToIso(value);
}

/** A carrier shipment whose creation outcome is unknown: only "Retry" can settle it. */
export function isUncertainShipment(s: Pick<ShipmentView, 'status' | 'error'>): boolean {
  return s.status === 'PENDING' && s.error === 'UNCERTAIN';
}

/**
 * A PENDING shipment with no outcome recorded that the server reports as stale (it stopped between
 * its two steps): the server treats it as uncertain and accepts "Retry". The server decides with
 * its own clock (`retryable`); the browser clock is never compared.
 */
export function isStuckPendingShipment(s: Pick<ShipmentView, 'status' | 'error' | 'retryable'>): boolean {
  return s.status === 'PENDING' && !s.error && s.retryable === true;
}

/**
 * Server field errors of a line-based request mapped to form paths: `lines.<index>.…` →
 * `lines.<orderLineId>` of the line sent at that index (or `lines`), a path listed in `fields` →
 * its form path. The first unmapped code is returned as `other`.
 */
export function mapServerFieldErrors(
  list: { path: string; code: string }[],
  sentLines: { orderLineId: number }[],
  fields: Record<string, string>
): { errors: FormErrors; other: string | null } {
  const errors: FormErrors = {};
  let other: string | null = null;
  for (const e of list) {
    const m = /^lines\.(\d+)(\.|$)/.exec(e.path);
    const sent = m ? sentLines[Number(m[1])] : undefined;
    const key = m ? (sent ? `lines.${sent.orderLineId}` : 'lines') : fields[e.path];
    if (key) {
      if (!errors[key]) errors[key] = e.code;
    } else if (!other) {
      other = e.code;
    }
  }
  return { errors, other };
}

export type ShipmentAction = 'DELIVER' | 'TRACKING' | 'REFRESH' | 'LABEL' | 'RETRY' | 'CANCEL';

/**
 * The buttons of one shipment, in display order. Mutations need `orders.manage` and an order that
 * is not archived; the label only needs to be readable. PENDING shipments only offer "Retry",
 * when the server reports them `retryable` (uncertain, or stuck).
 */
export function shipmentActions(
  s: ShipmentView,
  ctx: { orderStatus: OrderStatus; canManage: boolean }
): ShipmentAction[] {
  const manage = ctx.canManage && ctx.orderStatus !== 'ARCHIVED';
  const active = s.status === 'ACTIVE';
  const delivered = s.deliveryStatus === 'DELIVERED';
  const carrier = s.providerId !== 'manual';
  const out: ShipmentAction[] = [];
  if (manage && active && !delivered) out.push('DELIVER');
  if (manage && active) out.push('TRACKING');
  if (manage && active && carrier && !delivered) out.push('REFRESH');
  if (active && s.labelAvailable) out.push('LABEL');
  if (manage && s.status === 'PENDING' && s.retryable) out.push('RETRY');
  // A PENDING shipment may exist at the carrier: the server refuses to cancel it (SHIPMENT_UNCERTAIN).
  const cancellable = s.status === 'FAILED' || (active && !delivered);
  if (manage && cancellable) out.push('CANCEL');
  return out;
}
