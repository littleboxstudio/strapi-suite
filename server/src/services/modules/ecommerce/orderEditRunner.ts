/**
 * The idempotent runner every order edit goes through (plan 10, ruling 10), and the helpers
 * the edits share: the editability check, the totals write and the outcome rule.
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError, type ValidationIssue } from './errors';
import { isUniqueViolation } from './dbErrors';
import { computeTotals, type Address, type FinancialSummary, type OrderTotals } from './domain/orders';
import {
  clearFlag,
  raiseFlag,
  readReviewFlags,
  type OrderEditAction,
  type ReviewFlag,
  type ReviewFlagCode,
  type ReviewReason,
} from './domain/orderEditing';
import {
  chargedShipping,
  currentMethod,
  readShippingLines,
  type ShippingLine,
} from './domain/shippingLines';
import { readManualDiscounts, type ManualDiscount } from './domain/manualDiscounts';
import { modificationOutcome } from './domain/orderModification';
import type { CatalogVariant } from './orderPricingHelpers';
import type { DomainEventType } from './events';
import type { OrderHistoryEntry, OrderHistoryType } from './orderHistory';
import type { OrderState, OrderView } from './orders';
import type { EditKind, EditOutcome, EditResult } from './orderEditing';

const OPERATION_ID_MIN = 8;
const OPERATION_ID_MAX = 64;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** What the runner needs from the order service. */
export type OrderServiceLike = {
  computeOrderState(orderId: number): Promise<OrderState>;
  get(orderId: number): Promise<OrderView>;
  lockOrder(orderId: number): Promise<void>;
  recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
  loadCatalog(variantIds: number[], locale: string): Promise<Map<number, CatalogVariant>>;
};

export type OrderHistoryServiceLike = { record(entry: OrderHistoryEntry): Promise<void> };

export type EditHistoryEntry = Omit<OrderHistoryEntry, 'orderId' | 'actor' | 'operationId'>;

/** Writes of one edit: every history row carries the edit's actor and operationId. */
export type EditWriter = {
  actor: string;
  operationId: string;
  record(entry: EditHistoryEntry): Promise<void>;
  /** Raises `code` and records `REVIEW_FLAG_RAISED`. */
  raise(flags: ReviewFlag[], code: ReviewFlagCode, reason: ReviewReason): Promise<ReviewFlag[]>;
  /** Clears `code`; records `REVIEW_FLAG_CLEARED` only when it was raised. */
  clear(flags: ReviewFlag[], code: ReviewFlagCode): Promise<ReviewFlag[]>;
};

export type EditSteps<P> = {
  /** Outside the transaction (carrier quotes may be remote calls). */
  prepare: () => Promise<P>;
  /** Inside the transaction, on a fresh state of the locked order. */
  write: (
    state: OrderState,
    prepared: P,
    w: EditWriter
  ) => Promise<
    EditOutcome & {
      history: {
        type: OrderHistoryType;
        description: string;
        previousValue: object | null;
        newValue: object;
      };
    }
  >;
};

export type TotalsWrite = {
  /** The stored lines changed in this transaction: read them again. */
  lines?: true;
  shippingLines?: ShippingLine[];
  orderDiscount?: number;
  shippingDiscount?: number;
  manualDiscounts?: ManualDiscount[];
  reviewFlags?: ReviewFlag[];
  promotions?: object;
  shippingAddress?: Address;
};

const issue = (message: string, i: ValidationIssue) => new EcommerceValidationError(message, [i]);

const operationConflict = () =>
  issue('Invalid edit', { path: 'operationId', code: 'OPERATION_ID_CONFLICT' });

const isOperationConflict = (err: unknown) =>
  err instanceof EcommerceValidationError &&
  err.errors.some((e) => e.code === 'OPERATION_ID_CONFLICT');

/** The main history row's unique key: one application per operationId. */
const editKey = (operationId: string) => `edit:${operationId}`;

export function createEditRunner(
  strapi: Core.Strapi,
  deps: {
    orders: () => OrderServiceLike;
    history: () => OrderHistoryServiceLike;
    emit: (type: DomainEventType, event: { orderId: number; payload: Record<string, unknown> }) => Promise<void>;
  }
) {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };

  /**
   * The outcome of an earlier application of `operationId` for this order and kind, if any.
   * The same id used for another kind or on another order is a client bug: never its outcome.
   */
  const findApplied = async (
    orderId: number,
    kind: EditKind,
    operationId: string
  ): Promise<EditOutcome | null> => {
    const q = strapi.db.query(uids().orderHistory);
    const uniqueKey = editKey(operationId);
    const row = await q.findOne({ where: { uniqueKey, order: { id: orderId } } });
    if (row) {
      if (row.newValue?.kind !== kind) throw operationConflict();
      return {
        outcome: row.newValue?.outcome ?? 'NONE',
        difference: num(row.newValue?.difference),
      };
    }
    if (await q.findOne({ where: { uniqueKey } })) throw operationConflict();
    return null;
  };

  const writer = (orderId: number, actor: string, operationId: string): EditWriter => {
    const record = (entry: EditHistoryEntry) =>
      deps.history().record({ ...entry, orderId, actor, operationId });
    return {
      actor,
      operationId,
      record,
      async raise(flags, code, reason) {
        await record({
          type: 'REVIEW_FLAG_RAISED',
          description: `Review flag raised: ${code} (${reason})`,
          previousValue: null,
          newValue: { code, reason },
        });
        return raiseFlag(flags, { code, reason, raisedAt: new Date().toISOString(), actor });
      },
      async clear(flags, code) {
        const { flags: next, cleared } = clearFlag(flags, code);
        if (cleared) {
          await record({
            type: 'REVIEW_FLAG_CLEARED',
            description: `Review flag cleared: ${code}`,
            previousValue: { code },
            newValue: { code },
          });
        }
        return next;
      },
    };
  };

  const runEdit = async <P>(
    orderId: number,
    kind: EditKind,
    rawOperationId: string,
    actor: string,
    steps: EditSteps<P>
  ): Promise<EditResult> => {
    const operationId = typeof rawOperationId === 'string' ? rawOperationId.trim() : '';
    if (operationId.length < OPERATION_ID_MIN || operationId.length > OPERATION_ID_MAX) {
      throw issue('Invalid edit', { path: 'operationId', code: 'required' });
    }
    const orders = deps.orders();

    // A replay returns the current order before any precondition: the first request may
    // already have changed what is available.
    const replay = async (): Promise<EditResult | null> => {
      const applied = await findApplied(orderId, kind, operationId);
      return applied ? { order: await orders.get(orderId), ...applied } : null;
    };
    const earlier = await replay();
    if (earlier) return earlier;

    const prepared = await steps.prepare();
    let outcome: EditOutcome;
    try {
      outcome = await strapi.db.transaction(async () => {
        await orders.lockOrder(orderId);
        if (await findApplied(orderId, kind, operationId)) throw operationConflict();
        const state = await orders.computeOrderState(orderId);
        const result = await steps.write(state, prepared, writer(orderId, actor, operationId));
        const done: EditOutcome = { outcome: result.outcome, difference: result.difference };
        await deps.history().record({
          orderId,
          type: result.history.type,
          description: result.history.description,
          previousValue: result.history.previousValue,
          newValue: { ...result.history.newValue, kind, operationId, ...done },
          actor,
          operationId,
          uniqueKey: editKey(operationId),
        });
        await orders.recalculate(orderId, { actor, operationId });
        return done;
      });
    } catch (err) {
      // A concurrent request with the same operationId committed first (its main row's unique
      // key or a stock key was taken): its outcome is the answer.
      if (isOperationConflict(err) || isUniqueViolation(err)) {
        const winner = await replay();
        if (winner) return winner;
      }
      throw err;
    }
    // After the commit only.
    await deps.emit('ORDER_MODIFIED', { orderId, payload: { kind, ...outcome } });
    return { order: await orders.get(orderId), ...outcome };
  };

  /**
   * `ORDER_NOT_EDITABLE` (detail: why) unless the order is editable; `ORDER_HAS_SHIPMENTS` for an
   * action that needs no shipment once one exists.
   */
  const assertEditable = (state: OrderState, action: OrderEditAction): void => {
    const { editing } = state;
    if (!editing.editable) {
      throw issue('Order not editable', {
        path: 'order',
        code: 'ORDER_NOT_EDITABLE',
        ...(editing.blockedBy ? { detail: editing.blockedBy } : {}),
      });
    }
    if (!editing.actions.includes(action)) {
      throw issue('Order has shipments', { path: 'order', code: 'ORDER_HAS_SHIPMENTS' });
    }
  };

  /**
   * Recomputes and persists the totals from the stored lines and `data` (stored values for the
   * rest). New shipping lines sync the shipping columns (ruling 8). The three editing columns
   * are always written, so a legacy order persists what it read (ruling 2). Conditional on OPEN:
   * a cancel or archive that committed first gives `ORDER_NOT_EDITABLE` and rolls the edit back.
   */
  const writeTotals = async (state: OrderState, data: TotalsWrite): Promise<OrderTotals> => {
    const u = uids();
    const order = state.order;
    const lineRows: any[] = data.lines
      ? await strapi.db.query(u.orderLine).findMany({ where: { order: order.id } })
      : state.lines;
    const shippingLines = data.shippingLines ?? readShippingLines(order);
    const changes: Record<string, unknown> = {};
    let shippingOriginal = num(order.shippingOriginal);
    if (data.shippingLines) {
      shippingOriginal = chargedShipping(shippingLines);
      const method = currentMethod(shippingLines);
      const previous = (order.shippingMethod ?? {}) as Record<string, unknown>;
      const sameMethod =
        method && previous.providerId === method.providerId && previous.serviceId === method.serviceId;
      changes.shippingMethod = method
        ? {
            providerId: method.providerId,
            serviceId: method.serviceId,
            name: method.name,
            price: shippingOriginal,
            tax: method.tax,
            ...(sameMethod && previous.estimatedDays !== undefined
              ? { estimatedDays: previous.estimatedDays }
              : {}),
          }
        : { ...previous, price: shippingOriginal };
      changes.shippingTax = method ? method.tax : num(order.shippingTax);
    }
    // The shipping discount keeps its euro value, capped at the gross shipping (spec 6.3).
    const shippingDiscount = Math.max(
      0,
      Math.min(data.shippingDiscount ?? num(order.shippingDiscount), shippingOriginal)
    );
    const totals = computeTotals(
      lineRows.map((l) => ({
        unitPrice: num(l.unitPrice),
        unitDiscount: num(l.unitDiscount),
        quantity: num(l.quantity),
        returnedQuantity: num(l.returnedQuantity),
      })),
      {
        orderDiscount: data.orderDiscount ?? num(order.orderDiscount),
        shippingOriginal,
        shippingDiscount,
      }
    );
    if (data.promotions) changes.promotions = data.promotions;
    if (data.shippingAddress) changes.shippingAddress = data.shippingAddress;

    const { count } = await strapi.db.query(u.order).updateMany({
      where: { id: order.id, orderStatus: 'OPEN' },
      data: {
        ...changes,
        itemsOriginal: totals.itemsOriginal,
        productDiscount: totals.productDiscount,
        subtotal: totals.subtotal,
        orderDiscount: totals.orderDiscount,
        shippingOriginal,
        shippingDiscount,
        shippingTotal: totals.shippingTotal,
        total: totals.total,
        shippingLines: { lines: shippingLines },
        manualDiscounts: { items: data.manualDiscounts ?? readManualDiscounts(order) },
        reviewFlags: { flags: data.reviewFlags ?? readReviewFlags(order.reviewFlags) },
      },
    });
    if (count === 0) throw issue('Order not editable', { path: 'order', code: 'ORDER_NOT_EDITABLE' });
    return totals;
  };

  /** The same rule as `simulateModification`. */
  const outcomeOf = (before: FinancialSummary, after: FinancialSummary): EditOutcome['outcome'] =>
    modificationOutcome(before, after);

  return { runEdit, assertEditable, writeTotals, outcomeOf };
}
