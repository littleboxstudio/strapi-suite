import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError, type ValidationIssue } from './errors';
import { isUniqueViolation } from './dbErrors';
import { computeTotals, type OrderActionKey } from './domain/orders';
import { computeReturn, returnableQuantities, validateReturnRequest } from './domain/fulfillment';
import { refundableAmount } from './domain/refunds';
import type { OrderState } from './orders';
import type { OrderHistoryEntry } from './orderHistory';
import type { StockMoveInput } from './stock';

const MAX_REASON = 200;
const MAX_NOTES = 2000;
const MAX_KEY = 255;

export type ReturnInput = {
  lines: { orderLineId: number; quantity: number; restock: boolean }[];
  /** 1–200 characters. */
  reason: string;
  notes?: string;
  idempotencyKey: string;
};

export type ReturnItemView = {
  orderLineId: number;
  sku: string;
  name: string;
  option: string | null;
  quantity: number;
  restock: boolean;
  value: number;
};

export type ReturnView = {
  id: number;
  items: ReturnItemView[];
  grossValue: number;
  discountShare: number;
  refundableValue: number;
  reason: string | null;
  notes: string | null;
  actor: string | null;
  createdAt: string | null;
};

type Collector = { emit(e: any): void; flush(): Promise<void> };

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null => (v && typeof v === 'object' ? (v.id ?? null) : (v ?? null));

const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid return', [{ path, code }]);

/** The stored `items` JSON (`{ lines: [...] }`), malformed entries dropped. */
const returnItemsOf = (row: any): ReturnItemView[] => {
  const lines = row?.items?.lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((i: any) => i && typeof i === 'object' && Number.isInteger(Number(i.orderLineId)))
    .map((i: any) => ({
      orderLineId: Number(i.orderLineId),
      sku: typeof i.sku === 'string' ? i.sku : '',
      name: typeof i.name === 'string' ? i.name : '',
      option: typeof i.option === 'string' ? i.option : null,
      quantity: num(i.quantity),
      restock: i.restock === true,
      value: num(i.value),
    }));
};

const toView = (row: any): ReturnView => ({
  id: row.id,
  items: returnItemsOf(row),
  grossValue: num(row.grossValue),
  discountShare: num(row.discountShare),
  refundableValue: num(row.refundableValue),
  reason: row.reason ?? null,
  notes: row.notes ?? null,
  actor: row.actor ?? null,
  createdAt: row.createdAt ?? null,
});

const normalizeInput = (input: ReturnInput) => {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<ReturnInput>;
  const errors: ValidationIssue[] = [];
  const idempotencyKey = clean(raw.idempotencyKey);
  if (!idempotencyKey) errors.push({ path: 'idempotencyKey', code: 'required' });
  else if (idempotencyKey.length > MAX_KEY)
    errors.push({ path: 'idempotencyKey', code: 'too_long' });
  const reason = clean(raw.reason);
  if (!reason) errors.push({ path: 'reason', code: 'required' });
  else if (reason.length > MAX_REASON) errors.push({ path: 'reason', code: 'too_long' });
  const notes = clean(raw.notes) || null;
  if (notes && notes.length > MAX_NOTES) errors.push({ path: 'notes', code: 'too_long' });
  if (errors.length) throw new EcommerceValidationError('Invalid return', errors);
  return {
    lines: (Array.isArray(raw.lines) ? raw.lines : []) as ReturnInput['lines'],
    reason,
    notes,
    idempotencyKey,
  };
};

/**
 * Returns (design 4.11): shipped units coming back, each line restocked or not. A return lowers
 * the order total (and takes its share of the order discount back) but never refunds: the
 * admin refunds through `EcommerceRefundService` (reason RETURN), capped at the excess. It
 * changes neither the shipments nor the FulfillmentStatus.
 */
const EcommerceReturnService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    lockOrder(orderId: number): Promise<void>;
    computeOrderState(orderId: number): Promise<OrderState>;
    assertAction(state: OrderState, action: OrderActionKey, allowed?: boolean): void;
    recalculate(orderId: number, opts?: { actor?: string; operationId?: string }): Promise<unknown>;
  } => service('EcommerceOrderService');
  const stock = (): { move(input: StockMoveInput): Promise<{ applied: boolean }> } =>
    service('EcommerceStockService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');

  /** The return registered with `key`, refusing a key already used on another order. */
  const findByKey = async (orderId: number, key: string) => {
    const row = await strapi.db.query(uids().orderReturn).findOne({
      where: { idempotencyKey: key },
      populate: { order: { select: ['id'] } },
    });
    if (row && idOf(row.order) !== orderId)
      throw invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT');
    return row;
  };

  const listForOrder = async (orderId: number): Promise<ReturnView[]> => {
    const rows: any[] = await strapi.db.query(uids().orderReturn).findMany({
      where: { order: { id: Number(orderId) } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toView);
  };

  /** What is left to refund once in-flight refunds are counted, for the UI to offer. */
  const refundableNow = async (orderId: number): Promise<number> => {
    const state = await orders().computeOrderState(orderId);
    return refundableAmount(state.summary, state.inFlightRefunds);
  };

  const register = async (
    rawOrderId: number | string,
    input: ReturnInput,
    actor: string
  ): Promise<{ return: ReturnView; refundable: number }> => {
    const orderId = Number(rawOrderId);
    const n = normalizeInput(input);
    const u = uids();

    const answer = async (row: any) => ({
      return: toView(row),
      refundable: await refundableNow(orderId),
    });

    const existing = await findByKey(orderId, n.idempotencyKey);
    if (existing) return answer(existing);

    const collector = events().collector();
    let row: any;
    try {
      row = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        // A request with the same key that held the lock first already answered.
        const winner = await findByKey(orderId, n.idempotencyKey);
        if (winner) return { ...winner, replay: true };

        const state = await orders().computeOrderState(orderId);
        orders().assertAction(state, 'REGISTER_RETURN');
        const shipped = new Map(state.lines.map((l) => [l.id, l.shipped]));
        const issues = validateReturnRequest(returnableQuantities(state.lines, shipped), n.lines);
        if (issues.length) throw new EcommerceValidationError('Invalid return', issues);

        const order = state.order;
        const orderDiscountBefore = num(order.orderDiscount);
        const computed = computeReturn(
          state.lines.map((l) => ({
            id: l.id,
            unitPrice: l.unitPrice,
            unitDiscount: l.unitDiscount,
            quantity: l.quantity,
            returnedQuantity: l.returnedQuantity,
          })),
          orderDiscountBefore,
          n.lines
        );
        // A cancelled order already put every held unit back: restocking again would count
        // the unit twice.
        const cancelled = order.orderStatus === 'CANCELLED';
        const lineById = new Map(state.lines.map((l) => [l.id, l]));
        const items: ReturnItemView[] = computed.items.map((i, idx) => {
          const l = lineById.get(i.orderLineId)!;
          return {
            orderLineId: l.id,
            sku: l.sku,
            name: l.name,
            option: l.option ?? null,
            quantity: i.quantity,
            restock: !cancelled && n.lines[idx].restock,
            value: i.value,
          };
        });

        const created = await strapi.db.query(u.orderReturn).create({
          data: {
            order: orderId,
            items: { lines: items },
            grossValue: computed.grossValue,
            discountShare: computed.discountShare,
            refundableValue: computed.refundableValue,
            reason: n.reason,
            notes: n.notes,
            idempotencyKey: n.idempotencyKey,
            actor,
          },
        });

        for (const item of items) {
          const l = lineById.get(item.orderLineId)!;
          await strapi.db.query(u.orderLine).update({
            where: { id: l.id },
            data: { returnedQuantity: l.returnedQuantity + item.quantity },
          });
        }

        // Totals: the returned units leave the subtotal and their share of the order discount
        // leaves the stored discount. Never on an archived order (a concurrent archive that
        // committed first leaves 0 rows and rolls this return back).
        const storedLines: any[] = await strapi.db
          .query(u.orderLine)
          .findMany({ where: { order: orderId } });
        const totals = computeTotals(
          storedLines.map((l) => ({
            unitPrice: num(l.unitPrice),
            unitDiscount: num(l.unitDiscount),
            quantity: num(l.quantity),
            returnedQuantity: num(l.returnedQuantity),
          })),
          {
            orderDiscount: orderDiscountBefore - computed.discountShare,
            shippingOriginal: num(order.shippingOriginal),
            shippingDiscount: num(order.shippingDiscount),
          }
        );
        const { count } = await strapi.db.query(u.order).updateMany({
          where: { id: orderId, orderStatus: { $ne: 'ARCHIVED' } },
          data: {
            itemsOriginal: totals.itemsOriginal,
            productDiscount: totals.productDiscount,
            subtotal: totals.subtotal,
            orderDiscount: totals.orderDiscount,
            shippingTotal: totals.shippingTotal,
            total: totals.total,
          },
        });
        orders().assertAction(state, 'REGISTER_RETURN', count > 0);

        for (const item of items) {
          const l = lineById.get(item.orderLineId)!;
          await stock().move({
            variantId: l.variantId,
            quantity: item.quantity,
            type: item.restock ? 'RETURN_RESTOCK' : 'RETURN_NO_RESTOCK',
            operationKey: `return:${created.id}:${l.id}`,
            orderId,
            reason: `Return #${created.id} of order #${order.reference}`,
            actor,
          });
        }

        await history().record({
          orderId,
          type: 'RETURN_REGISTERED',
          description: `Return #${created.id} registered: ${computed.refundableValue} cents`,
          previousValue: { orderDiscount: orderDiscountBefore, total: num(order.total) },
          newValue: {
            returnId: created.id,
            lines: items.map((i) => ({
              orderLineId: i.orderLineId,
              quantity: i.quantity,
              restock: i.restock,
              value: i.value,
            })),
            grossValue: computed.grossValue,
            discountShare: computed.discountShare,
            refundableValue: computed.refundableValue,
            orderDiscount: totals.orderDiscount,
            total: totals.total,
          },
          actor,
        });
        await orders().recalculate(orderId, { actor });

        collector.emit({
          type: 'RETURN_REGISTERED',
          orderId,
          payload: { returnId: created.id, refundableValue: computed.refundableValue },
        });
        return created;
      });
    } catch (err) {
      // A concurrent request with the same key committed first: its return is the answer.
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, n.idempotencyKey);
        if (winner) return answer(winner);
      }
      throw err;
    }
    if (!row.replay) await collector.flush();
    return answer(row);
  };

  return { register, listForOrder };
};

export default EcommerceReturnService;
