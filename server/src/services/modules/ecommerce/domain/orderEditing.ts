/**
 * Order editing rules: which edits are offered, and the review flags an edit raises.
 * Pure: no Strapi imports.
 */
import type { OrderStatus } from './orders';

export type OrderEditAction =
  | 'ADD_PRODUCTS'
  | 'EDIT_ADDRESS'
  | 'RECALCULATE_SHIPPING'
  | 'EDIT_SHIPPING_LINE'
  | 'ADD_SHIPPING_LINE'
  | 'RECALCULATE_DISCOUNTS'
  | 'ADD_DISCOUNT'
  | 'REMOVE_DISCOUNT';

export type EditBlockReason = 'CANCELLED' | 'ARCHIVED' | 'SHIPMENT_PENDING';

export type OrderEditing = {
  editable: boolean;
  blockedBy: EditBlockReason | null;
  hasShipments: boolean;
  actions: OrderEditAction[];
};

const ALL_ACTIONS: OrderEditAction[] = [
  'ADD_PRODUCTS',
  'EDIT_ADDRESS',
  'RECALCULATE_SHIPPING',
  'EDIT_SHIPPING_LINE',
  'ADD_SHIPPING_LINE',
  'RECALCULATE_DISCOUNTS',
  'ADD_DISCOUNT',
  'REMOVE_DISCOUNT',
];

/** Actions that change what was already sent, so they need no active shipment. */
const NEEDS_NO_SHIPMENT: OrderEditAction[] = ['EDIT_ADDRESS', 'EDIT_SHIPPING_LINE'];

export function orderEditing(input: {
  orderStatus: OrderStatus;
  hasPendingShipment: boolean;
  hasActiveShipment: boolean;
}): OrderEditing {
  const hasShipments = input.hasActiveShipment;
  const blockedBy: EditBlockReason | null =
    input.orderStatus === 'CANCELLED'
      ? 'CANCELLED'
      : input.orderStatus === 'ARCHIVED'
        ? 'ARCHIVED'
        : input.hasPendingShipment
          ? 'SHIPMENT_PENDING'
          : null;
  if (blockedBy) return { editable: false, blockedBy, hasShipments, actions: [] };
  const actions = ALL_ACTIONS.filter((a) => !(hasShipments && NEEDS_NO_SHIPMENT.includes(a)));
  return { editable: true, blockedBy: null, hasShipments, actions };
}

export type ReviewFlagCode = 'SHIPPING_REVIEW' | 'DISCOUNTS_REVIEW';
export type ReviewReason =
  | 'PRODUCTS_CHANGED'
  | 'ADDRESS_CHANGED'
  | 'SHIPPING_CHANGED'
  | 'SHIPPING_QUOTE_FAILED';

export type ReviewFlag = { code: ReviewFlagCode; reason: ReviewReason; raisedAt: string; actor: string };

const CODES: ReviewFlagCode[] = ['SHIPPING_REVIEW', 'DISCOUNTS_REVIEW'];
const REASONS: ReviewReason[] = [
  'PRODUCTS_CHANGED',
  'ADDRESS_CHANGED',
  'SHIPPING_CHANGED',
  'SHIPPING_QUOTE_FAILED',
];

/** Reads the stored `{ flags }` object leniently; unknown shapes give no flags. */
export function readReviewFlags(stored: unknown): ReviewFlag[] {
  const list = (stored as { flags?: unknown } | null | undefined)?.flags;
  if (!Array.isArray(list)) return [];
  const out: ReviewFlag[] = [];
  for (const f of list) {
    if (typeof f !== 'object' || f === null) continue;
    if (!CODES.includes(f.code) || !REASONS.includes(f.reason)) continue;
    if (out.some((o) => o.code === f.code)) continue;
    out.push({
      code: f.code,
      reason: f.reason,
      raisedAt: typeof f.raisedAt === 'string' ? f.raisedAt : '',
      actor: typeof f.actor === 'string' ? f.actor : '',
    });
  }
  return out;
}

/** Raises a flag; a flag with the same code is replaced, so each code appears once. */
export function raiseFlag(flags: ReviewFlag[], flag: ReviewFlag): ReviewFlag[] {
  return [...flags.filter((f) => f.code !== flag.code), flag];
}

export function clearFlag(
  flags: ReviewFlag[],
  code: ReviewFlagCode
): { flags: ReviewFlag[]; cleared: boolean } {
  const next = flags.filter((f) => f.code !== code);
  return { flags: next, cleared: next.length !== flags.length };
}
