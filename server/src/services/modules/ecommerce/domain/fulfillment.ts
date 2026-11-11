/**
 * Pure shipment, delivery and return domain rules (no Strapi imports). Money is integer cents.
 */
import {
  orderDiscountShareForReturn,
  type FulfillmentStatus,
  type LineAmounts,
  type ShipmentLike,
  type ShipmentStatus,
} from './orders';
import { EcommerceValidationError } from '../errors';

export type { ShipmentStatus };

export const DELIVERY_STATUSES = ['IN_TRANSIT', 'DELIVERED', 'EXCEPTION'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type OrderDeliveryStatus = 'NONE' | 'IN_TRANSIT' | 'PARTIALLY_DELIVERED' | 'DELIVERED';

export type ValidationIssue = { path: string; code: string };

/** Delivery date tolerance against clock skew. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

/** Units already shipped (ACTIVE) or being shipped (PENDING) per order line. */
export const reservedQuantities = (shipments: ShipmentLike[]): Map<number, number> => {
  const reserved = new Map<number, number>();
  for (const s of shipments) {
    if (s.status !== 'ACTIVE' && s.status !== 'PENDING') continue;
    for (const item of s.items) {
      reserved.set(item.orderLineId, (reserved.get(item.orderLineId) ?? 0) + item.quantity);
    }
  }
  return reserved;
};

const validateLineRequest = (
  request: { orderLineId: number; quantity: number }[],
  limitOf: (orderLineId: number) => number | undefined,
  exceededCode: string,
): ValidationIssue[] => {
  if (!Array.isArray(request) || request.length === 0) return [{ path: 'lines', code: 'required' }];
  const issues: ValidationIssue[] = [];
  const seen = new Set<number>();
  request.forEach((r, i) => {
    if (r === null || typeof r !== 'object') {
      issues.push({ path: `lines.${i}`, code: 'invalid_line' });
      return;
    }
    if (seen.has(r.orderLineId)) {
      issues.push({ path: `lines.${i}.orderLineId`, code: 'duplicate_line' });
      return;
    }
    seen.add(r.orderLineId);
    const limit = Number.isInteger(r.orderLineId) ? limitOf(r.orderLineId) : undefined;
    if (limit === undefined) {
      issues.push({ path: `lines.${i}.orderLineId`, code: 'unknown_line' });
      return;
    }
    if (!Number.isInteger(r.quantity) || r.quantity < 1) {
      issues.push({ path: `lines.${i}.quantity`, code: 'invalid_quantity' });
      return;
    }
    if (r.quantity > limit) issues.push({ path: `lines.${i}.quantity`, code: exceededCode });
  });
  return issues;
};

export const validateShipmentRequest = (
  lines: { id: number; quantity: number }[],
  reserved: Map<number, number>,
  request: { orderLineId: number; quantity: number }[],
): ValidationIssue[] => {
  const byId = new Map(lines.map((l) => [l.id, l.quantity]));
  return validateLineRequest(
    request,
    (id) => {
      const q = byId.get(id);
      return q === undefined ? undefined : Math.max(0, q - (reserved.get(id) ?? 0));
    },
    'QUANTITY_EXCEEDS_PENDING',
  );
};

type CostShipment = { status: ShipmentStatus; shippingCost: number };

/** Sum of the shipping cost of ACTIVE shipments. */
export const previousShipmentsCost = (shipments: CostShipment[]): number =>
  shipments.reduce((sum, s) => (s.status === 'ACTIVE' ? sum + s.shippingCost : sum), 0);

/** Shipping left to attribute to the next shipment (prefill). */
export const remainingShippingCost = (shippingTotal: number, shipments: CostShipment[]): number =>
  Math.max(0, shippingTotal - previousShipmentsCost(shipments));

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export const orderDeliveryStatus = (
  fulfillment: FulfillmentStatus,
  shipments: { status: ShipmentStatus; deliveryStatus?: DeliveryStatus | null }[],
): OrderDeliveryStatus => {
  const active = shipments.filter((s) => s.status === 'ACTIVE');
  if (active.length === 0) return 'NONE';
  const delivered = active.filter((s) => s.deliveryStatus === 'DELIVERED').length;
  if (delivered === 0) return 'IN_TRANSIT';
  if (delivered === active.length && fulfillment === 'FULFILLED') return 'DELIVERED';
  return 'PARTIALLY_DELIVERED';
};

export const validateDeliveryDate = (deliveredAt: unknown, shippedAt: string, now: Date): ValidationIssue[] => {
  const path = 'deliveredAt';
  if (typeof deliveredAt !== 'string' && !(deliveredAt instanceof Date)) return [{ path, code: 'invalid_date' }];
  const at = new Date(deliveredAt).getTime();
  if (Number.isNaN(at)) return [{ path, code: 'invalid_date' }];
  const shipped = new Date(shippedAt).getTime();
  if (Number.isNaN(shipped)) return [{ path: 'shippedAt', code: 'invalid_shipped_at' }];
  // Up to FUTURE_TOLERANCE_MS before the shipment is clock skew (`normalizeDeliveryDate` clamps it).
  if (at < shipped - FUTURE_TOLERANCE_MS) return [{ path, code: 'before_shipment' }];
  if (at > now.getTime() + FUTURE_TOLERANCE_MS) return [{ path, code: 'in_future' }];
  return [];
};

/** A delivery date that passed `validateDeliveryDate`, as stored: never before the shipment. */
export const normalizeDeliveryDate = (deliveredAt: string | Date, shippedAt: string): string => {
  const at = new Date(deliveredAt).getTime();
  const shipped = new Date(shippedAt).getTime();
  return new Date(Number.isNaN(shipped) ? at : Math.max(at, shipped)).toISOString();
};

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

/** Returnable per line = shipped (ACTIVE) minus already returned, floored at 0. */
export const returnableQuantities = (
  lines: { id: number; returnedQuantity: number }[],
  shipped: Map<number, number>,
): Map<number, number> => {
  const out = new Map<number, number>();
  for (const l of lines) out.set(l.id, Math.max(0, (shipped.get(l.id) ?? 0) - l.returnedQuantity));
  return out;
};

export const validateReturnRequest = (
  returnable: Map<number, number>,
  request: { orderLineId: number; quantity: number; restock: boolean }[],
): ValidationIssue[] => {
  const issues = validateLineRequest(request, (id) => returnable.get(id), 'QUANTITY_EXCEEDS_RETURNABLE');
  if (Array.isArray(request)) {
    request.forEach((r, i) => {
      if (r !== null && typeof r === 'object' && typeof r.restock !== 'boolean') issues.push({ path: `lines.${i}.restock`, code: 'invalid_restock' });
    });
  }
  return issues;
};

export type ReturnComputation = {
  items: { orderLineId: number; quantity: number; value: number }[];
  grossValue: number;
  discountShare: number;
  refundableValue: number;
};

/**
 * `lines` must reflect the order before this return. Call after `validateReturnRequest`;
 * an unknown `orderLineId` throws.
 */
export const computeReturn = (
  lines: (LineAmounts & { id: number })[],
  orderDiscount: number,
  request: { orderLineId: number; quantity: number }[],
): ReturnComputation => {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const items = request.map((r) => {
    const l = byId.get(r.orderLineId);
    if (!l) {
      throw new EcommerceValidationError('Unknown order line', [{ path: 'lines', code: 'unknown_line' }]);
    }
    const value = (l.unitPrice - l.unitDiscount) * r.quantity;
    return { orderLineId: r.orderLineId, quantity: r.quantity, value };
  });
  const grossValue = items.reduce((sum, i) => sum + i.value, 0);
  const discountShare = orderDiscountShareForReturn(lines, orderDiscount, request);
  return { items, grossValue, discountShare, refundableValue: grossValue - discountShare };
};
