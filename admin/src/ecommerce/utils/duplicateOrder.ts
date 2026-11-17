/**
 * Duplicate an order (spec 2026-11-17-duplicate-order-design): the order as a Create order draft.
 * Prices, promotions and shipping are quoted again; nothing is copied from the old totals, and
 * payments, invoices, shipments, returns, refunds, notes and history are left out.
 */
import { addressFormFromAddress, emptyOrderForm, normalizePromotionCodes } from './orderForm';
import type { AddressForm, DraftManualDiscount, OrderForm, OrderLineDraft } from './orderForm';
import { isStorePickupMethod } from './pickupPoints';
import type { FieldError, Order, OrderQuote, PickupSelection, ShippingOption } from '../orderTypes';

export type ShippingRef = { providerId: string; serviceId: string };

export type DuplicateDraft = {
  /** The Create order form; its shipping waits for the options (`shipping`, `pickup`). */
  form: OrderForm;
  /** Per GIFT promotion, the variant the order received. */
  giftChoices: Record<number, number>;
  /** The gift variants' labels, for a notice when one is no longer offered. */
  giftNames: Record<number, string>;
  /** The order's shipping method, restored once the options are quoted. */
  shipping: ShippingRef | null;
  /** The order's pickup point or store. */
  pickup: PickupSelection | null;
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const label = (l: { name: string; option: string | null }) => (l.option ? `${l.name} — ${l.option}` : l.name);

/** Billing-only fields aside, the two addresses are the same. */
const sameAddress = (a: AddressForm, b: AddressForm) =>
  (Object.keys(a) as (keyof AddressForm)[]).every((k) => k === 'company' || k === 'nif' || a[k] === b[k]);

const methodOf = (m: unknown): ShippingRef | null => {
  const r = m as { providerId?: unknown; serviceId?: unknown } | null | undefined;
  const providerId = text(r?.providerId);
  return providerId ? { providerId, serviceId: text(r?.serviceId) } : null;
};

/** The order's method, or the last shipping charge's when it stored none. */
const shippingOf = (order: Order): ShippingRef | null => {
  const stored = methodOf(order.shippingMethod);
  if (stored) return stored;
  const lines = Array.isArray(order.shippingLines) ? order.shippingLines : [];
  return lines.length ? methodOf(lines[lines.length - 1]) : null;
};

export function duplicateDraft(order: Order, opts: { legacyReason: string }): DuplicateDraft {
  const point = order.pickupPoint ?? null;
  // A pickup order delivers to the point: the customer's own address is the one they typed.
  const shippingAddress = addressFormFromAddress(point?.customerAddress ?? order.shippingAddress);
  const billingAddress = order.billingAddress ? addressFormFromAddress(order.billingAddress) : { ...shippingAddress };

  const lines: OrderLineDraft[] = [];
  (order.lines ?? []).forEach((l) => {
    if (l.isGift) return;
    const quantity = l.quantity - (l.returnedQuantity ?? 0);
    if (quantity <= 0) return;
    const same = lines.find((d) => d.variantId === l.variantId);
    if (same) {
      same.quantity += quantity;
      return;
    }
    lines.push({
      variantId: l.variantId,
      name: l.name,
      option: l.option,
      sku: l.sku,
      unitPrice: l.unitPrice,
      stock: null,
      imageUrl: l.imageUrl,
      quantity,
      ...(typeof l.manualDiscountPercent === 'number' ? { discount: String(l.manualDiscountPercent) } : {}),
    });
  });

  const codes = Array.isArray(order.promotionCodes)
    ? order.promotionCodes.filter((c) => c.status === 'APPLIED').map((c) => c.code)
    : (order.promotions ?? []).map((p) => p.code ?? '');

  const giftChoices: Record<number, number> = {};
  const giftNames: Record<number, string> = {};
  (order.lines ?? []).forEach((l) => {
    if (!l.isGift) return;
    giftNames[l.variantId] = label(l);
    const promotionId = l.promotionIds?.[0];
    if (typeof promotionId === 'number' && !(promotionId in giftChoices)) giftChoices[promotionId] = l.variantId;
  });

  const manualDiscounts: DraftManualDiscount[] = (order.manualDiscounts ?? []).map((m, i) => {
    const key = `dup-${i}`;
    if (m.kind === 'PERCENT' && typeof m.percent === 'number') {
      return { key, kind: 'PERCENT', value: m.percent, reason: m.reason };
    }
    // LEGACY (and a percent without its value): the amount it took off.
    const reason = m.kind === 'LEGACY' && !m.reason?.trim() ? opts.legacyReason : m.reason;
    return { key, kind: 'FIXED', value: m.amount, reason };
  });

  const shipping = shippingOf(order);
  const pickup: PickupSelection | null = point
    ? {
        point: {
          id: point.id,
          name: point.name,
          address: point.address,
          address2: point.address2 ?? null,
          postalCode: point.postalCode,
          city: point.city,
          country: point.country,
          openingHours: [],
        },
        // A store is chosen from a list; a DPD point is confirmed by a search of its postal code.
        postalCode: isStorePickupMethod(shipping) ? '' : point.postalCode,
      }
    : null;

  const customer = order.customer ?? ({} as Order['customer']);
  return {
    form: {
      ...emptyOrderForm(order.locale ?? ''),
      customer: {
        firstName: text(customer.firstName),
        lastName: text(customer.lastName),
        email: text(customer.email),
        phone: text(customer.phone),
      },
      shippingAddress,
      billingAddress,
      billingSameAsShipping: sameAddress(shippingAddress, billingAddress),
      lines,
      promotionCodes: normalizePromotionCodes(codes),
      manualDiscounts,
    },
    giftChoices,
    giftNames,
    shipping,
    pickup,
  };
}

/** The lines a quote refused as VARIANT_UNAVAILABLE are dropped (the same array when none is). */
export function dropUnavailableLines(
  lines: OrderLineDraft[],
  errors: FieldError[]
): { lines: OrderLineDraft[]; dropped: OrderLineDraft[] } {
  const gone = new Set<number>();
  errors.forEach(({ path, code }) => {
    const m = /^lines\.(\d+)\.variantId$/.exec(path);
    if (m && code === 'VARIANT_UNAVAILABLE') gone.add(Number(m[1]));
  });
  if (!gone.size) return { lines, dropped: [] };
  return {
    lines: lines.filter((_, i) => !gone.has(i)),
    dropped: lines.filter((_, i) => gone.has(i)),
  };
}

/**
 * What the first quote of a duplicate did not keep: the copied codes that did not apply (one
 * waiting for the shipping is not refused) and the copied gift variants it no longer gives.
 */
export function duplicateQuoteNotices(
  copied: { codes: string[]; giftChoices: Record<number, number> },
  quote: OrderQuote
): { refusedCodes: string[]; missingGifts: number[] } {
  const refusedCodes = copied.codes.filter((code) => {
    const status = quote.codes.find((c) => c.code === code)?.status;
    return status !== 'APPLIED' && status !== 'AWAITING_SHIPPING';
  });
  const given = new Set(quote.lines.filter((l) => l.isGift).map((l) => l.variantId));
  const missingGifts = Object.values(copied.giftChoices).filter((v) => !given.has(v));
  return { refusedCodes, missingGifts };
}

export type RestoredShipping = {
  shipping: OrderForm['shipping'];
  pickup: PickupSelection | null;
  /** METHOD_GONE: the method is not offered; PICKUP_GONE: the store is not. */
  notice: 'METHOD_GONE' | 'PICKUP_GONE' | null;
  /** A DPD point is kept until a search of its postal code confirms it. */
  checkPoint: boolean;
};

/** The duplicated order's method and point, when the quoted `options` still offer them. */
export function restoreDuplicateShipping(
  wanted: ShippingRef | null,
  pickup: PickupSelection | null,
  options: ShippingOption[]
): RestoredShipping {
  const none: RestoredShipping = { shipping: null, pickup: null, notice: null, checkPoint: false };
  if (!wanted) return none;
  const option = options.find((o) => o.providerId === wanted.providerId && o.serviceId === wanted.serviceId);
  if (!option) return { ...none, notice: 'METHOD_GONE' };
  const shipping = {
    providerId: option.providerId,
    serviceId: option.serviceId,
    ...(option.requiresPickupPoint ? { requiresPickupPoint: true } : {}),
  };
  if (!option.requiresPickupPoint || !pickup) return { ...none, shipping };
  if (isStorePickupMethod(option)) {
    const offered = (option.pickupPoints ?? []).some((s) => s.id === pickup.point.id);
    return offered ? { ...none, shipping, pickup } : { ...none, shipping, notice: 'PICKUP_GONE' };
  }
  return { shipping, pickup, notice: null, checkPoint: true };
}
