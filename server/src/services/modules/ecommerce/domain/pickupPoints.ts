import type { Address } from './orders';
import { EcommerceValidationError } from '../errors';
import { MAX_PICKUP_POINT_ID_LENGTH } from './storefront/limits';
import { STORE_PICKUP_ID, STORE_PICKUP_SERVICE_ID } from './storePickup';

/** A pickup point as the pickup service returns it (spec 5.1); `openingHours` is not stored. */
export type PickupPointInput = {
  id: string;
  name: string;
  address: string;
  address2: string | null;
  postalCode: string;
  city: string;
  country: string;
};

/**
 * The pickup point stored on the order (Ruling 9). `customerAddress` is the delivery address the
 * customer sent, kept so it can be restored when the order leaves Pickup (spec 5.2, 5.3). It is
 * an admin-only field: storefront views never include it.
 */
export type OrderPickupPoint = {
  id: string;
  name: string;
  address: string;
  address2: string | null;
  postalCode: string;
  city: string;
  country: string;
  customerAddress: Address;
};

/** The DPD service whose shipping options require a pickup point (Ruling 7). */
export const PICKUP_PROVIDER_ID = 'dpd-portugal';
export const PICKUP_SERVICE_ID = 'PICKUP';

/** Whether a shipping method is DPD Pickup (a DPD pickup point, searched at DPD). */
export const isDpdPickup = (providerId: unknown, serviceId: unknown): boolean =>
  providerId === PICKUP_PROVIDER_ID && serviceId === PICKUP_SERVICE_ID;

/** Whether a shipping method is Store pickup (one of the shop's stores, from the config). */
export const isStorePickup = (providerId: unknown, serviceId: unknown): boolean =>
  providerId === STORE_PICKUP_ID && serviceId === STORE_PICKUP_SERVICE_ID;

/**
 * Whether a shipping method delivers to a stored point (store pickup ruling 2): DPD Pickup or
 * Store pickup. What is specific to each (search, carrier request) uses the functions above.
 */
export const isPickupMethod = (providerId: unknown, serviceId: unknown): boolean =>
  isDpdPickup(providerId, serviceId) || isStorePickup(providerId, serviceId);

/**
 * Whether two methods take the same kind of point (both DPD Pickup or both Store pickup): only
 * then can a stored point be kept when the order's method changes.
 */
export const samePickupKind = (
  a: { providerId?: unknown; serviceId?: unknown } | null | undefined,
  b: { providerId?: unknown; serviceId?: unknown } | null | undefined
): boolean =>
  (isDpdPickup(a?.providerId, a?.serviceId) && isDpdPickup(b?.providerId, b?.serviceId)) ||
  (isStorePickup(a?.providerId, a?.serviceId) && isStorePickup(b?.providerId, b?.serviceId));

/**
 * Spec 5.2: the delivery address becomes the point's (company = point name; address, postal
 * code, city and country of the point), with the customer's name and phone (DPD uses them to
 * notify the customer). The customer's address is kept on the stored point.
 */
export const applyPickupPoint = (
  customerAddress: Address,
  point: PickupPointInput
): { shippingAddress: Address; pickupPoint: OrderPickupPoint } => {
  const shippingAddress: Address = {
    firstName: customerAddress.firstName,
    lastName: customerAddress.lastName,
    ...(customerAddress.phone ? { phone: customerAddress.phone } : {}),
    company: point.name,
    line1: point.address,
    ...(point.address2 ? { line2: point.address2 } : {}),
    postalCode: point.postalCode,
    city: point.city,
    country: point.country,
  };
  return {
    shippingAddress,
    pickupPoint: {
      id: point.id,
      name: point.name,
      address: point.address,
      address2: point.address2 ?? null,
      postalCode: point.postalCode,
      city: point.city,
      country: point.country,
      customerAddress: { ...customerAddress },
    },
  };
};

/** The pickup point stored on an order, or null. */
export const readPickupPoint = (order: unknown): OrderPickupPoint | null => {
  const p = (order as { pickupPoint?: unknown } | null)?.pickupPoint;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as OrderPickupPoint) : null;
};

/** The point as the order history shows it. */
export const pointSummary = (p: OrderPickupPoint | null) => (p ? { id: p.id, name: p.name } : null);

/**
 * The `ADDRESS_CHANGED` history entry of a delivery change (a new or removed point): order editing
 * and the store swap at Ship write the same entry.
 */
export const deliveryChangeEntry = (
  order: { shippingAddress?: unknown; pickupPoint?: unknown },
  change: { shippingAddress: Address; pickupPoint: OrderPickupPoint | null }
) => ({
  type: 'ADDRESS_CHANGED' as const,
  description: change.pickupPoint
    ? `Shipping address changed: pickup point ${change.pickupPoint.id}`
    : 'Shipping address changed: pickup point removed',
  previousValue: {
    shippingAddress: (order.shippingAddress as Address | undefined) ?? null,
    pickupPoint: pointSummary(readPickupPoint(order)),
  },
  newValue: {
    shippingAddress: change.shippingAddress,
    pickupPoint: pointSummary(change.pickupPoint),
  },
});

/** The pickup point a request names (`pickupPointId`, optional `pickupPostalCode`). */
export type PickupSelection = { pickupPointId?: unknown; pickupPostalCode?: unknown };

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Whether `input` names a pickup point (a non-blank `pickupPointId`). */
export const hasPickupPointId = (input: PickupSelection | null | undefined): boolean =>
  cleanText(input?.pickupPointId) !== '';

/**
 * Confirms the point `input` names with the pickup search (spec 5.2, 5.3), before any write.
 * The search uses `pickupPostalCode`, else `fallbackPostalCode`.
 * - id missing or blank → `PICKUP_POINT_REQUIRED`; not a string → `invalid`; too long or not
 *   returned by the search → `PICKUP_POINT_INVALID` (all on `pickupPointId`);
 * - the search's `INVALID_POSTAL_CODE` → on `pickupPostalCode` (or `fallbackPostalCodePath`),
 *   its other validation codes (`PICKUP_NOT_AVAILABLE`) → on `shipping`;
 * - a failed search (`PICKUP_SEARCH_FAILED`, a carrier error) is rethrown as is.
 */
export const findPickupPoint = async <P extends PickupPointInput>(
  findPoint: (postalCode: string, id: string) => Promise<P | null>,
  input: PickupSelection,
  fallbackPostalCode: string,
  fallbackPostalCodePath: string
): Promise<P> => {
  const refuse = (path: string, code: string) =>
    new EcommerceValidationError('Invalid pickup point', [{ path, code }]);
  const rawId = input?.pickupPointId;
  if (rawId !== undefined && rawId !== null && typeof rawId !== 'string') {
    throw refuse('pickupPointId', 'invalid');
  }
  const id = cleanText(rawId);
  if (!id) throw refuse('pickupPointId', 'PICKUP_POINT_REQUIRED');
  if (id.length > MAX_PICKUP_POINT_ID_LENGTH) throw refuse('pickupPointId', 'PICKUP_POINT_INVALID');
  const rawCode = input?.pickupPostalCode;
  if (rawCode !== undefined && rawCode !== null && typeof rawCode !== 'string') {
    throw refuse('pickupPostalCode', 'invalid');
  }
  const pickupPostalCode = cleanText(rawCode);
  const postalCodePath = pickupPostalCode ? 'pickupPostalCode' : fallbackPostalCodePath;
  let point: P | null;
  try {
    point = await findPoint(pickupPostalCode || fallbackPostalCode, id);
  } catch (err) {
    // The search's own paths (`postalCode`, `country`) are moved to the request's.
    if (err instanceof EcommerceValidationError) {
      throw new EcommerceValidationError(
        err.message,
        err.errors.map((e) =>
          e.code === 'INVALID_POSTAL_CODE'
            ? { path: postalCodePath, code: e.code }
            : { path: 'shipping', code: e.code }
        )
      );
    }
    throw err; // PICKUP_SEARCH_FAILED (EcommerceCarrierError)
  }
  if (!point) throw refuse('pickupPointId', 'PICKUP_POINT_INVALID');
  return point;
};
