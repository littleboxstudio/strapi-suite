/**
 * Helpers for the flows that change an order's lines (the editing service): the simulation
 * inputs, the carrier quote items and the line and stock writes. The stored-shape readers
 * (`appliedOf`, `toPaymentLike`, `toRefundLike`) are shared with the order service.
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError } from './errors';
import type { PaymentLike, RefundLike } from './domain/orders';
import type {
  CatalogVariant as ModificationCatalogVariant,
  ExistingLine,
  ModificationCurrent,
  ModificationResult,
} from './domain/orderModification';
import type { AppliedPromotion } from './domain/promotions';
import { isRecord, type CatalogVariant } from './orderPricingHelpers';
import type { ShippingQuoteRequest } from './shipping';
import type { StockMoveInput } from './stock';
import type { OrderState } from './orders';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The promotions an order stored (`{ applied, … }`); a legacy `[]` reads as none. */
export const appliedOf = (order: any): AppliedPromotion[] =>
  isRecord(order?.promotions) && Array.isArray(order.promotions.applied)
    ? order.promotions.applied.filter(isRecord)
    : [];

export const toPaymentLike = (p: any): PaymentLike => ({ status: p.status, amount: num(p.amount) });

export const toRefundLike = (r: any): RefundLike => ({
  status: r.status,
  amount: num(r.amount),
  kind: r.kind === 'STORE_CREDIT' ? 'STORE_CREDIT' : 'MONEY',
  promoted: r.metadata?.promotedFromFailed === true,
});

/** A stock key already taken: the operationId was used elsewhere. */
const operationConflict = () =>
  new EcommerceValidationError('Invalid modification', [
    { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
  ]);

export type QuoteUnit = {
  variantId: number;
  /** The line's quantity after the change; the units already reserved are taken off. */
  quantity: number;
  orderLineId?: number;
  sourceOrderLineId?: number;
  /** The unit discount after the change (a manual discount set or removed, spec 4.1). */
  unitDiscount?: number;
};

export function createOrderModificationSupport(strapi: Core.Strapi) {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const stock = (): { move(input: StockMoveInput): Promise<{ applied: boolean }> } =>
    strapi.plugin(PLUGIN_ID).service('EcommerceStockService');

  const toModificationCurrent = (state: OrderState): ModificationCurrent => ({
    lines: state.lines.map((l): ExistingLine => ({
      id: l.id,
      variantId: l.variantId,
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      option: l.option ?? '',
      tax: l.tax,
      shipped: l.shipped,
      isGift: l.isGift,
      unitPrice: l.unitPrice,
      unitDiscount: l.unitDiscount,
      quantity: l.quantity,
      returnedQuantity: l.returnedQuantity,
      manualDiscountPercent: l.manualDiscountPercent,
      promotionIds: l.promotionIds,
    })),
    orderDiscount: num(state.order.orderDiscount),
    shippingOriginal: num(state.order.shippingOriginal),
    shippingDiscount: num(state.order.shippingDiscount),
    payments: state.payments.map(toPaymentLike),
    refunds: state.refunds.map(toRefundLike),
    promotions: appliedOf(state.order),
    email:
      typeof state.order.customerSnapshot?.email === 'string'
        ? state.order.customerSnapshot.email
        : null,
  });

  const toModificationCatalog = (catalog: Map<number, CatalogVariant>) => {
    const out = new Map<number, ModificationCatalogVariant>();
    for (const [id, c] of catalog) {
      out.set(id, {
        variantId: c.variantId,
        productId: c.productId,
        sku: c.sku,
        name: c.name,
        option: c.option ?? '',
        unitPrice: c.price,
        tax: c.tax,
        imageUrl: c.imageUrl,
        stock: c.stock,
        active: c.active,
      });
    }
    return out;
  };

  /**
   * The carrier quote items for `units`, net of the units already reserved by a shipment.
   * Items and subtotal share that base; an existing line is priced at its net unit price, extra
   * units of a discounted line at the source's full price, a new variant at the catalog price.
   */
  const quoteItems = (
    state: OrderState,
    units: QuoteUnit[],
    catalog: Map<number, CatalogVariant>
  ): { items: ShippingQuoteRequest['items']; subtotal: number } => {
    const linesById = new Map(state.lines.map((l) => [l.id, l]));
    const items: ShippingQuoteRequest['items'] = [];
    let subtotal = 0;
    for (const u of units) {
      const line = u.orderLineId !== undefined ? linesById.get(u.orderLineId) : undefined;
      const quantity = u.quantity - (line?.reserved ?? 0);
      if (quantity <= 0) continue;
      const v = catalog.get(u.variantId);
      const source =
        u.sourceOrderLineId !== undefined ? linesById.get(u.sourceOrderLineId) : undefined;
      const unitNet = line
        ? line.unitPrice - (u.unitDiscount ?? line.unitDiscount)
        : source
          ? source.unitPrice
          : (v?.price ?? 0) - (u.unitDiscount ?? 0);
      subtotal += unitNet * quantity;
      items.push({
        variantId: u.variantId,
        quantity,
        weight: v?.weight ?? 0,
        width: v?.width ?? 0,
        height: v?.height ?? 0,
        depth: v?.depth ?? 0,
      });
    }
    return { items, subtotal };
  };

  /**
   * Persists a validated simulation's line changes and stock movements. A line with nothing
   * shipped or returned that drops to 0 is deleted (its units come back with the restock
   * movement); otherwise it keeps quantity 0. A stock key already taken rolls everything back
   * with `OPERATION_ID_CONFLICT`. History is the caller's.
   */
  const writeLineChanges = async (
    state: OrderState,
    catalog: Map<number, CatalogVariant>,
    result: Pick<ModificationResult, 'lineChanges' | 'stockMovements'>,
    ctx: { actor: string; operationId: string; stockKey: (variantId: number) => string }
  ): Promise<void> => {
    const u = uids();
    const order = state.order;
    const orderId = order.id as number;
    const byId = new Map(state.lines.map((l) => [l.id, l]));
    let position = Math.max(-1, ...(order.lines ?? []).map((l: any) => num(l.position))) + 1;
    for (const change of result.lineChanges) {
      if (change.kind === 'UNCHANGED') continue;
      if (change.kind === 'ADDED') {
        // Extra units of a discounted line copy that line's snapshot at its full price.
        const source =
          change.sourceOrderLineId !== undefined ? byId.get(change.sourceOrderLineId) : undefined;
        const c = source
          ? {
              variantId: source.variantId,
              productId: source.productId,
              sku: source.sku,
              name: source.name,
              option: source.option,
              imageUrl: source.imageUrl,
              price: source.unitPrice,
              tax: source.tax,
            }
          : catalog.get(change.variantId)!;
        await strapi.db.query(u.orderLine).create({
          data: {
            order: orderId,
            variant: c.variantId,
            variantId: c.variantId,
            productId: c.productId,
            sku: c.sku,
            name: c.name,
            option: c.option,
            imageUrl: c.imageUrl,
            unitPrice: c.price,
            unitDiscount: change.discount?.unitDiscount ?? 0,
            manualDiscountPercent: change.discount?.percent ?? null,
            quantity: change.newQuantity,
            returnedQuantity: 0,
            tax: c.tax,
            isGift: false,
            promotionRefs: { refs: [] },
            position: position++,
          },
        });
        continue;
      }
      const line = byId.get(change.orderLineId!)!;
      if (change.newQuantity === 0 && line.shipped === 0 && line.returnedQuantity === 0) {
        await strapi.db.query(u.orderLine).delete({ where: { id: line.id } });
      } else {
        // A manual discount set or removed (spec 4.1) replaces any promotion discount: no refs.
        await strapi.db.query(u.orderLine).update({
          where: { id: line.id },
          data: {
            quantity: change.newQuantity,
            ...(change.discount
              ? {
                  unitDiscount: change.discount.unitDiscount,
                  manualDiscountPercent: change.discount.percent,
                  promotionRefs: { refs: [] },
                }
              : {}),
          },
        });
      }
    }

    for (const m of result.stockMovements) {
      const { applied } = await stock().move({
        variantId: m.variantId,
        quantity: m.quantity,
        type: m.quantity < 0 ? 'ORDER_DEDUCT' : 'ORDER_RESTOCK',
        operationKey: ctx.stockKey(m.variantId),
        orderId,
        reason: `Order #${order.reference} modified`,
        actor: ctx.actor,
      });
      if (!applied) throw operationConflict();
    }
  };

  return { toModificationCurrent, toModificationCatalog, quoteItems, writeLineChanges };
}
