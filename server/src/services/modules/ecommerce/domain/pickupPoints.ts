import type { Address } from './orders';

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

/** Whether a shipping method delivers to a pickup point (DPD Pickup). */
export const isPickupMethod = (providerId: unknown, serviceId: unknown): boolean =>
  providerId === PICKUP_PROVIDER_ID && serviceId === PICKUP_SERVICE_ID;

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
