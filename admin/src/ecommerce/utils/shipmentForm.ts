import type { CreateShipmentInput, Order, OrderStatus, PickupStore, ShipMethodOption, ShipmentView } from '../orderTypes';
import { STORE_PICKUP_ID, pickupErrorId } from './pickupPoints';

/** Mirror the server limits. */
export const MAX_CARRIER_NAME = 120;
export const MAX_TRACKING_CODE = 255;
export const MAX_TRACKING_URL = 2000;
export const MAX_CANCEL_REASON = 500;
export const MAX_PARCELS = 99;

export type ShipLineDraft = { orderLineId: number; quantity: string };

export type ShipForm = {
  lines: ShipLineDraft[];
  /** The chosen delivery method (`shipMethodKey`); '' when none is offered. */
  methodKey: string;
  /** Manual methods only. */
  trackingCode: string;
  trackingUrl: string;
  /** Carrier methods that ask for it (DPD): number of parcels (text). */
  parcels: string;
  /** Store pickup: the chosen store's id ('' for none). */
  storeId: string;
};

/** Field path (`lines.<orderLineId>`, `lines`, `method`, `trackingUrl`, …) → error code. */
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

/** A delivery method's identity in the ship form (radio value). */
export function shipMethodKey(m: Pick<ShipMethodOption, 'providerId' | 'serviceId'>): string {
  return `${m.providerId}:${m.serviceId ?? ''}`;
}

/** The preselected method: the order's own (`original`), else the first offered; '' for none. */
export function defaultShipMethodKey(methods: ShipMethodOption[]): string {
  const m = methods.find((x) => x.original) ?? methods[0];
  return m ? shipMethodKey(m) : '';
}

/** The method chosen in `form`, or null. */
export function selectedShipMethod(form: Pick<ShipForm, 'methodKey'>, methods: ShipMethodOption[]): ShipMethodOption | null {
  return methods.find((m) => shipMethodKey(m) === form.methodKey) ?? null;
}

/** The store preselected for Store pickup: the order's own; '' without one. */
export function defaultShipStoreId(methods: ShipMethodOption[]): string {
  return methods.find((m) => m.kind === 'STORE_PICKUP')?.selectedStoreId ?? '';
}

/** Store pickup: the order's store can no longer change (a store pickup shipment of it is active). */
export function shipStoreLocked(method: ShipMethodOption | null): boolean {
  return method?.kind === 'STORE_PICKUP' && method.storeLocked === true;
}

/**
 * The store `storeId` names among the Store pickup method's stores (the order's own when the store
 * is locked); null otherwise.
 */
export function shipStore(method: ShipMethodOption | null, storeId: string): PickupStore | null {
  if (method?.kind !== 'STORE_PICKUP') return null;
  const id = shipStoreLocked(method) ? (method.selectedStoreId ?? '') : storeId;
  return method.stores?.find((s) => s.id === id) ?? null;
}

/** The message id of a Store pickup error at Ship (PICKUP_ADDRESS_LOCKED: the store is fixed). */
export function shipStoreErrorId(code: string): string {
  return code === 'PICKUP_ADDRESS_LOCKED' ? 'ecommerce.orders.ship.storeLocked' : pickupErrorId(code, true);
}

/** An integer 1–99 typed in the parcels field; null otherwise. */
export function parseParcels(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_PARCELS ? n : null;
}

/** `methods`: the offered delivery methods; the order's own is preselected. */
export function emptyShipForm(
  order: Pick<Order, 'lines'>,
  methods: ShipMethodOption[] = []
): ShipForm {
  return {
    lines: defaultShipLines(order.lines),
    methodKey: defaultShipMethodKey(methods),
    trackingCode: '',
    trackingUrl: '',
    parcels: '1',
    storeId: defaultShipStoreId(methods),
  };
}

/**
 * Checks the ship form (requirement 10.4): 0 ≤ quantity ≤ pending, at least one unit, a delivery
 * method (`method`: the selected one), its tracking (manual), parcels (DPD) or store (Store pickup).
 */
export function validateShipForm(
  form: ShipForm,
  lines: { id: number; pending: number }[],
  method: ShipMethodOption | null
): FormErrors {
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

  if (!method) {
    errors.method = 'required';
  } else if (method.kind === 'STORE_PICKUP') {
    if (!shipStore(method, form.storeId)) errors.store = 'PICKUP_POINT_REQUIRED';
  } else if (method.kind === 'MANUAL') {
    if (form.trackingCode.trim().length > MAX_TRACKING_CODE) errors.trackingCode = 'too_long';
    const url = form.trackingUrl.trim();
    if (url && !isHttpUrl(url)) errors.trackingUrl = 'invalid_url';
  } else if (method.parcels && parseParcels(form.parcels) === null) {
    errors.parcels = 'invalid';
  }
  return errors;
}

/**
 * The request body of a form `validateShipForm` accepted, shipped with `method`: a manual one
 * carries its name as the carrier and the typed tracking; a carrier one only its ids (the
 * carrier returns the tracking and the label); Store pickup its store. The customer is always notified.
 */
export function buildShipmentInput(
  form: ShipForm,
  idempotencyKey: string,
  method: ShipMethodOption
): CreateShipmentInput {
  const lines = form.lines
    .map((l) => ({ orderLineId: l.orderLineId, quantity: parseQuantity(l.quantity) ?? 0 }))
    .filter((l) => l.quantity > 0);
  let shipMethod: CreateShipmentInput['method'];
  if (method.kind === 'MANUAL') {
    const trackingCode = form.trackingCode.trim();
    const trackingUrl = form.trackingUrl.trim();
    shipMethod = {
      mode: 'MANUAL',
      providerId: 'manual',
      ...(method.serviceId ? { serviceId: method.serviceId } : {}),
      carrierName: method.name.trim().slice(0, MAX_CARRIER_NAME),
      ...(trackingCode ? { trackingCode } : {}),
      ...(trackingUrl ? { trackingUrl } : {}),
    };
  } else if (method.kind === 'STORE_PICKUP') {
    shipMethod = { mode: 'STORE_PICKUP', pickupPointId: shipStore(method, form.storeId)?.id ?? form.storeId };
  } else {
    shipMethod = { mode: 'CARRIER', providerId: method.providerId, serviceId: method.serviceId };
  }
  return {
    lines,
    method: shipMethod,
    notifyCustomer: true,
    idempotencyKey,
    ...(method.kind === 'CARRIER' && method.parcels ? { parcels: parseParcels(form.parcels) ?? 1 } : {}),
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
 * A shipment whose outcome is unknown at a carrier that may create it twice (DPD): never retried;
 * the admin checks the carrier's portal and marks it as failed when it is not there.
 */
export function isRetryUnsafeShipment(s: Pick<ShipmentView, 'status' | 'retryable' | 'carrierSupport'>): boolean {
  return s.status === 'PENDING' && s.retryable === true && s.carrierSupport?.retry === false;
}

/**
 * The notice after creating a shipment (not FAILED): success when ACTIVE; for a PENDING one, the
 * "check the carrier's portal" text only when it is settled by hand now (retry-unsafe and
 * `retryable`), otherwise the pending hint.
 */
export function shipResultMessageId(
  s: Pick<ShipmentView, 'status' | 'retryable' | 'carrierSupport'>
): string {
  if (s.status !== 'PENDING') return 'ecommerce.orders.ship.success';
  return isRetryUnsafeShipment(s)
    ? 'ecommerce.orders.errors.CARRIER_RETRY_UNSAFE'
    : 'ecommerce.orders.ship.uncertain';
}

/**
 * The warning of the cancel dialog. Only a shipment that reached the carrier (ACTIVE) is
 * cancelled there, or must be cancelled on its portal (no cancel API: DPD); a manual or a FAILED
 * one is only cancelled here.
 */
export function cancelWarningId(
  s: Pick<ShipmentView, 'status' | 'providerId' | 'carrierSupport'>
): string {
  if (s.providerId === 'manual' || s.providerId === STORE_PICKUP_ID || s.status !== 'ACTIVE') {
    return 'ecommerce.orders.shipments.cancel.warning';
  }
  return s.carrierSupport?.cancel === false
    ? 'ecommerce.orders.shipments.cancel.localWarning'
    : 'ecommerce.orders.shipments.cancel.carrierWarning';
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

export type ShipmentAction = 'DELIVER' | 'TRACKING' | 'REFRESH' | 'LABEL' | 'RETRY' | 'MARK_FAILED' | 'CANCEL';

/**
 * The buttons of one shipment, in display order. Mutations need `orders.manage` and an order that
 * is not archived; the label only needs to be readable. PENDING shipments only offer "Retry",
 * when the server reports them `retryable` (uncertain, or stuck), or "Mark as failed" instead for
 * a carrier that cannot be retried safely (DPD).
 */
export function shipmentActions(
  s: ShipmentView,
  ctx: { orderStatus: OrderStatus; canManage: boolean }
): ShipmentAction[] {
  const manage = ctx.canManage && ctx.orderStatus !== 'ARCHIVED';
  const active = s.status === 'ACTIVE';
  const delivered = s.deliveryStatus === 'DELIVERED';
  // A store pickup shipment has no carrier and no tracking (store pickup spec 7).
  const store = s.providerId === STORE_PICKUP_ID;
  const carrier = s.providerId !== 'manual' && !store;
  const out: ShipmentAction[] = [];
  if (manage && active && !delivered) out.push('DELIVER');
  if (manage && active && !store) out.push('TRACKING');
  if (manage && active && carrier && !delivered && s.carrierSupport?.tracking !== false) out.push('REFRESH');
  if (active && s.labelAvailable) out.push('LABEL');
  if (manage && isRetryUnsafeShipment(s)) out.push('MARK_FAILED');
  else if (manage && s.status === 'PENDING' && s.retryable) out.push('RETRY');
  // A PENDING shipment may exist at the carrier: the server refuses to cancel it (SHIPMENT_UNCERTAIN).
  const cancellable = s.status === 'FAILED' || (active && !delivered);
  if (manage && cancellable) out.push('CANCEL');
  return out;
}
