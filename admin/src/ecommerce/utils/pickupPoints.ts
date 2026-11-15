import { apiErrorCode } from './orderDetail';
import type { PickupPoint, PickupPointInput, PickupSelection, PickupStore } from '../orderTypes';

/** The Store pickup module's provider id (store pickup spec 3). */
export const STORE_PICKUP_ID = 'store-pickup';

type MethodRef = { providerId: string; serviceId?: string | null };

/** The codes a pickup search answers with; anything else reads as a failed search. */
const SEARCH_CODES = ['INVALID_POSTAL_CODE', 'PICKUP_NOT_AVAILABLE', 'PICKUP_SEARCH_FAILED'];

/** A Portuguese postal code (`NNNN-NNN`, the dash optional) as `NNNN-NNN`; null otherwise. */
export function normalizePickupPostalCode(raw: string): string | null {
  const m = /^(\d{4})-?(\d{3})$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Compact opening hours: one row per run of consecutive days with the same hours, e.g.
 * `Mon–Fri 09:00–13:00, 14:00–19:00`. `day` is 1–7 (Monday first).
 */
export function formatOpeningHours(
  hours: PickupPoint['openingHours'],
  dayName: (day: number) => string
): string[] {
  const byDay = new Map<number, string[]>();
  [...hours]
    .sort((a, b) => a.day - b.day || a.from.localeCompare(b.from))
    .forEach((h) => byDay.set(h.day, [...(byDay.get(h.day) ?? []), `${h.from}–${h.to}`]));
  const runs: { first: number; last: number; ranges: string }[] = [];
  [...byDay.keys()]
    .sort((a, b) => a - b)
    .forEach((day) => {
      const ranges = (byDay.get(day) ?? []).join(', ');
      const prev = runs[runs.length - 1];
      if (prev && prev.last === day - 1 && prev.ranges === ranges) prev.last = day;
      else runs.push({ first: day, last: day, ranges });
    });
  return runs.map((r) =>
    `${r.first === r.last ? dayName(r.first) : `${dayName(r.first)}–${dayName(r.last)}`} ${r.ranges}`
  );
}

/** The short weekday name of `day` (1 = Monday) in `locale`. */
export function weekdayName(day: number, locale: string): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, day))
  );
}

/** The point's display lines. */
export function pickupPointLines(p: Pick<PickupPoint, 'name' | 'address' | 'address2' | 'postalCode' | 'city'>) {
  return {
    name: p.name,
    address: p.address2 ? `${p.address}, ${p.address2}` : p.address,
    place: `${p.postalCode} ${p.city}`,
  };
}

/** The request fields of a chosen point; none when nothing is chosen. A store has no postal code search. */
export function pickupSelectionInput(selection: PickupSelection | null): PickupPointInput {
  if (!selection) return {};
  return selection.postalCode
    ? { pickupPointId: selection.point.id, pickupPostalCode: selection.postalCode }
    : { pickupPointId: selection.point.id };
}

/**
 * The chosen point when it differs from the order's (`currentId`); null otherwise. Choosing the
 * order's own point again keeps it (it may no longer be offered: a removed store).
 */
export function newPickupSelection(
  selection: PickupSelection | null,
  currentId: string | null | undefined
): PickupSelection | null {
  return selection && selection.point.id !== currentId ? selection : null;
}

/** A Store pickup method or option. */
export function isStorePickupMethod(m: MethodRef | null | undefined): boolean {
  return m?.providerId === STORE_PICKUP_ID;
}

/** The stores a shipping option offers (Store pickup); null when it is not a store option. */
export function storeChoices(
  option: (MethodRef & { pickupPoints?: PickupStore[] }) | null | undefined
): PickupStore[] | null {
  return isStorePickupMethod(option) ? (option?.pickupPoints ?? []) : null;
}

/** A store as a picker selection (no postal code search, no opening hours). */
export function storeSelection(store: PickupStore): PickupSelection {
  return { point: { ...store, openingHours: [] }, postalCode: '' };
}

const pickupKind = (m: MethodRef | null | undefined): 'STORE' | 'DPD' | null =>
  isStorePickupMethod(m) ? 'STORE' : m?.providerId === 'dpd-portugal' && m?.serviceId === 'PICKUP' ? 'DPD' : null;

/**
 * Whether the order's stored point counts for `option` (as the server keeps it): only when the
 * order's method takes the same kind of point (a DPD point is no store, and the other way round).
 */
export function orderPointKept(
  orderMethod: MethodRef | null | undefined,
  orderHasPoint: boolean,
  option: MethodRef | null | undefined
): boolean {
  const kind = pickupKind(option);
  return orderHasPoint && kind !== null && kind === pickupKind(orderMethod);
}

/**
 * The picker choice to keep when the shipping option changes from `previous` to `next`: only for
 * the same option and, for a store, while it is still offered.
 */
export function keptPickup(
  previous: MethodRef | null | undefined,
  next: MethodRef & { pickupPoints?: PickupStore[] },
  selection: PickupSelection | null | undefined
): PickupSelection | null {
  if (!selection || !previous) return null;
  if (previous.providerId !== next.providerId || (previous.serviceId ?? '') !== (next.serviceId ?? '')) return null;
  const stores = storeChoices(next);
  if (stores && !stores.some((s) => s.id === selection.point.id)) return null;
  return selection;
}

/** Codes with a store wording when the point is a store. */
const STORE_ERROR_CODES = ['PICKUP_POINT_REQUIRED', 'PICKUP_POINT_INVALID'];

/** The message id of an error code shown by a pickup picker (`store`: a store picker). */
export function pickupErrorId(code: string, store: boolean): string {
  return store && STORE_ERROR_CODES.includes(code)
    ? `ecommerce.orders.pickup.store.errors.${code}`
    : `ecommerce.orders.errors.${code}`;
}

/**
 * Whether a shipping option needs the picker: `REQUIRED` for DPD Pickup on an order without a
 * point, `OPTIONAL` when the order already has one (it is kept unless another is chosen).
 */
export function pickupNeeded(
  option: { providerId: string; serviceId: string; requiresPickupPoint?: boolean } | null | undefined,
  orderHasPoint: boolean
): 'REQUIRED' | 'OPTIONAL' | 'NONE' {
  if (!option?.requiresPickupPoint) return 'NONE';
  return orderHasPoint ? 'OPTIONAL' : 'REQUIRED';
}

/** The code to show for a failed pickup search. */
export function pickupSearchErrorCode(err: unknown): string {
  const code = apiErrorCode(err);
  return code && SEARCH_CODES.includes(code) ? code : 'PICKUP_SEARCH_FAILED';
}
