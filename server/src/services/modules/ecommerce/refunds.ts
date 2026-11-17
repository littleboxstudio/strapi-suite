import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommercePaymentError, EcommerceValidationError } from './errors';
import { maskStoreCreditCode } from './paymentMask';
import { isUniqueViolation } from './dbErrors';
import { str } from './providers/http';
import {
  createStripeClient,
  isDefinitiveStripeRejection,
  type StripeClient,
} from './providers/payments/stripeClient';
import { MAX_MONEY_CENTS, type OrderActionKey } from './domain/orders';
import {
  allocateStripeRefund,
  moneyCapacity,
  refundableAmount,
  refundItemsOf,
  validateRefundRequest,
  type RefundItem,
  type RefundSource,
} from './domain/refunds';
import { refundCreditLine, type CreditOptions } from './domain/creditNotes';
import type { InvoiceDoc } from './domain/invoiceSelection';
import type { RefundElementInvoice } from './invoices';
import type { OrderHistoryEntry } from './orderHistory';
import type { OrderState } from './orders';
import type { ProviderRuntime } from './providers/registry';
import type {
  IssueStoreCreditInput,
  RestoreStoreCreditInput,
  RestoreStoreCreditResult,
  StoreCreditView,
} from './storeCredits';

export const REFUND_METHODS = ['MANUAL_TRANSFER', 'STORE_CREDIT', 'STRIPE'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/**
 * EXCESS: gives back money paid above the total (the total does not change). INVOICED (plan 15):
 * gives back invoiced value not yet credited and lowers the order total by its amount.
 */
export const REFUND_SCOPES = ['EXCESS', 'INVOICED'] as const;
export type RefundScope = (typeof REFUND_SCOPES)[number];

export type CreateRefundInput = {
  method: RefundMethod;
  /** Defaults to EXCESS. */
  scope?: RefundScope | null;
  /**
   * Integer cents > 0, at most the refundable amount. INVOICED: optional, the sum of `items`; one
   * that differs is refused (`REFUND_AMOUNT_DIFFERS`).
   */
  amount?: number;
  /**
   * INVOICED (required, plan 15): the invoiced elements given back, whole units of ITEM lines or a
   * whole SHIPPING line (quantity 1) of the order's ISSUED invoices. Ignored for EXCESS.
   */
  items?: { invoiceId: number; index: number; quantity: number }[] | null;
  reason: string;
  description?: string | null;
  /** MANUAL_TRANSFER: the transfer reference. */
  reference?: string | null;
  /** STORE_CREDIT (new credit): validity, defaults to +12 months. */
  expiresAt?: string | null;
  /** STORE_CREDIT (new credit): conditions shown to the customer. */
  conditions?: string | null;
  /**
   * The source payment. STORE_CREDIT on a `STORE_CREDIT` payment gives the amount back to that
   * payment's credit instead of issuing a new one. Optional for MANUAL_TRANSFER (informative).
   */
  paymentId?: number | null;
  /** Required. A repeated key returns the refunds it created. */
  idempotencyKey: string;
};

export type RefundView = {
  id: number;
  method: RefundMethod;
  kind: 'MONEY' | 'STORE_CREDIT';
  scope: RefundScope;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  amount: number;
  currency: string;
  reason: string | null;
  description: string | null;
  reference: string | null;
  externalId: string | null;
  actor: string | null;
  createdAt: string | null;
  completedAt: string | null;
  payment: {
    id: number;
    method: string;
    status: string;
    amount: number;
    reference: string | null;
    externalId: string | null;
  } | null;
  /** The id only: the code is read through the store credit endpoints (customers permission). */
  storeCredit: { id: number } | null;
  /** INVOICED refunds: the credit note documenting it, once one was issued or is being issued. */
  creditNoteId: number | null;
  /** INVOICED refunds (plan 15): the elements it gave back, with their values; empty for legacy ones. */
  items: RefundItem[];
  /**
   * Whether Remove is offered (plan 15), with the remove rules: INVOICED and COMPLETED, no credit
   * note, order not archived, not STRIPE, and for STORE_CREDIT its own credit unused. Set by
   * `list`; absent elsewhere.
   */
  removable?: boolean;
};

export type RefundLimits = {
  refundable: number;
  /** At most `refundable`: what may go back as money (store-credit value never does). */
  moneyRefundable: number;
  stripeRefundable: number;
};

export type RefundPreview = {
  orderTotal: number;
  received: number;
  refunded: number;
  inFlight: number;
  /** The excess left to refund (EXCESS scope), as `refundable`. */
  excess: number;
  /** Invoiced value an INVOICED refund may still give back (plan 15). */
  invoicedRefundable: number;
  /** EXCESS limits (kept at the top level for older readers). */
  refundable: number;
  moneyRefundable: number;
  stripeRefundable: number;
  hasStripe: boolean;
  limits: Record<RefundScope, RefundLimits>;
  /**
   * The elements an INVOICED refund may pick (plan 15), per ISSUED invoice, with their available
   * values: live credit notes and active refunds' elements are left out. Empty unless the order is
   * OPEN.
   */
  invoicedElements: { invoices: RefundElementInvoice[] };
};

type Collector = { emit(e: any): void; flush(): Promise<void> };

/** Refund statuses that hold part of a payment (a FAILED/CANCELLED refund gives it back). */
const HOLDING = ['PENDING', 'PROCESSING', 'COMPLETED'];
const MAX_TEXT = 5000;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const errorLabel = (err: unknown): string => {
  if (err instanceof EcommercePaymentError) return `${err.name}:${err.code}`;
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
};

const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid refund', [{ path, code }]);

/** Keys the service generates itself: a client key in this namespace is refused. */
const RESERVED_KEY = /^cancel-credit:/;

/** `metadata.creditNoteId` as a positive integer id, else null. */
const creditNoteIdOf = (r: any): number | null => {
  const raw = r?.metadata?.creditNoteId;
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const toRefundView = (r: any): RefundView => {
  const p = r.payment && typeof r.payment === 'object' ? r.payment : null;
  const sc = r.storeCredit && typeof r.storeCredit === 'object' ? r.storeCredit : null;
  return {
    id: r.id,
    method: r.method,
    kind: r.kind,
    scope: r.scope === 'INVOICED' ? 'INVOICED' : 'EXCESS',
    creditNoteId: creditNoteIdOf(r),
    items: r.scope === 'INVOICED' ? (refundItemsOf(r) ?? []) : [],
    status: r.status,
    amount: num(r.amount),
    currency: r.currency ?? 'EUR',
    reason: r.reason ?? null,
    description: r.description ?? null,
    reference: r.reference ?? null,
    externalId: r.externalId ?? null,
    actor: r.actor ?? null,
    createdAt: r.createdAt ?? null,
    completedAt: r.completedAt ?? null,
    payment: p
      ? {
          id: p.id,
          method: p.method,
          status: p.status,
          amount: num(p.amount),
          // A STORE_CREDIT payment keeps the voucher code as its reference: never shown here.
          reference: p.method === 'STORE_CREDIT' ? null : (p.reference ?? null),
          externalId: p.externalId ?? null,
        }
      : null,
    storeCredit: sc ? { id: sc.id } : null,
  };
};

/** A COMPLETED Stripe payment keeps its PaymentIntent id (`pi_…`) in `externalId`. */
const paymentIntentOf = (p: any): string | null =>
  typeof p?.externalId === 'string' && p.externalId.startsWith('pi_') ? p.externalId : null;

/** Amount of `paymentId` already refunded or being refunded. */
const heldOn = (refunds: any[], paymentId: number): number =>
  refunds
    .filter((r) => idOf(r.payment) === paymentId && HOLDING.includes(r.status))
    .reduce((s, r) => s + num(r.amount), 0);

const stripeSources = (state: OrderState): RefundSource[] =>
  state.payments
    .filter((p) => p.method === 'STRIPE')
    .map((p) => ({
      paymentId: p.id,
      method: 'STRIPE' as const,
      status: p.status,
      amount: num(p.amount),
      refundedOrInFlight: heldOn(state.refunds, p.id),
      paymentIntentId: paymentIntentOf(p),
      completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : '',
    }));

const stripeCapacity = (state: OrderState): number =>
  allocateStripeRefund(MAX_MONEY_CENTS, stripeSources(state)).allocations.reduce(
    (s, a) => s + a.amount,
    0
  );

/**
 * Refunds (design 4.14): never above the refundable amount (`summary.excess` minus the
 * in-flight refunds), never touching the original payments or the stock. MANUAL_TRANSFER and
 * STORE_CREDIT complete at once; STRIPE creates one PROCESSING refund per allocated payment and
 * calls Stripe outside any database transaction, then applies Stripe's answer (the webhook
 * finishes asynchronous ones).
 */
const EcommerceRefundService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    computeOrderState(orderId: number): Promise<OrderState>;
    assertAction(state: OrderState, action: OrderActionKey): void;
    recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
    lockOrder(orderId: number): Promise<void>;
  } => service('EcommerceOrderService');
  const storeCredits = (): {
    issue(
      input: IssueStoreCreditInput,
      opts?: { collector?: { emit(e: any): void } }
    ): Promise<StoreCreditView>;
    restore(
      input: RestoreStoreCreditInput,
      opts?: { collector?: { emit(e: any): void } }
    ): Promise<RestoreStoreCreditResult>;
    void(id: number, actor: string): Promise<StoreCreditView>;
  } => service('EcommerceStoreCreditService');
  const settings = (): {
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
  } => service('EcommerceSettingsService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');
  const invoices = (): {
    refundElements(
      orderId: number,
      state: OrderState
    ): Promise<{
      targets: { row: any; invoice: InvoiceDoc; options: CreditOptions }[];
      invoices: RefundElementInvoice[];
    }>;
  } => service('EcommerceInvoiceService');

  /** The Stripe client when Stripe is active and has a secret key, otherwise null. */
  const stripeClient = async (): Promise<StripeClient | null> => {
    const rt = await settings().getRuntime('stripe');
    if (!rt || !rt.active || !str(rt, 'secretKey')) return null;
    return createStripeClient(rt);
  };

  const refundRows = (where: Record<string, unknown>): Promise<any[]> =>
    strapi.db.query(uids().refund).findMany({
      where,
      populate: {
        order: { select: ['id'] },
        payment: true,
        storeCredit: { select: ['id', 'code'] },
      },
      orderBy: { id: 'asc' },
    });

  const rowById = async (id: number) =>
    (await refundRows({ id }))[0] ?? null;

  const eventPayload = (r: any, extra: Record<string, unknown> = {}) => ({
    refundId: r.id,
    amount: num(r.amount),
    method: r.method,
    kind: r.kind,
    reference: r.reference ?? null,
    description: r.description ?? null,
    externalId: r.externalId ?? null,
    storeCreditId: idOf(r.storeCredit),
    ...extra,
  });

  const historyValue = (r: any) => ({
    refundId: r.id,
    method: r.method,
    kind: r.kind,
    amount: num(r.amount),
    paymentId: idOf(r.payment),
    storeCreditId: idOf(r.storeCredit),
    externalId: r.externalId ?? null,
    ...(r.scope === 'INVOICED' ? { scope: 'INVOICED' } : {}),
    ...(r.scope === 'INVOICED' && refundItemsOf(r) ? { items: refundItemsOf(r) } : {}),
  });

  /** The limits of each scope: EXCESS from the excess, INVOICED from the invoiced value (plan 15). */
  const refundContext = async (state: OrderState) => {
    const money = moneyCapacity(
      state.payments.map((p) => ({ method: p.method, status: p.status, amount: num(p.amount) })),
      state.refunds.map((r) => ({ kind: r.kind, status: r.status, amount: num(r.amount) }))
    );
    const capacity = stripeCapacity(state);
    const stripeActive = !!(await stripeClient());
    const hasStripe = stripeActive && capacity > 0;
    const limitsOf = (refundable: number): RefundLimits => {
      const moneyRefundable = Math.min(refundable, money);
      return {
        refundable,
        moneyRefundable,
        stripeRefundable: hasStripe ? Math.min(moneyRefundable, capacity) : 0,
      };
    };
    const limits: Record<RefundScope, RefundLimits> = {
      EXCESS: limitsOf(refundableAmount(state.summary, state.inFlightRefunds)),
      INVOICED: limitsOf(state.invoicedRefundable ?? 0),
    };
    return { ...limits.EXCESS, hasStripe, limits };
  };

  const preview = async (rawOrderId: number | string): Promise<RefundPreview> => {
    const orderId = Number(rawOrderId);
    const state = await orders().computeOrderState(orderId);
    const ctx = await refundContext(state);
    const elements =
      state.order.orderStatus === 'OPEN' ? (await invoices().refundElements(orderId, state)).invoices : [];
    return {
      orderTotal: state.summary.orderTotal,
      received: state.summary.paid,
      refunded: state.summary.refunded,
      inFlight: state.inFlightRefunds,
      excess: ctx.limits.EXCESS.refundable,
      invoicedRefundable: ctx.limits.INVOICED.refundable,
      refundable: ctx.refundable,
      moneyRefundable: ctx.moneyRefundable,
      stripeRefundable: ctx.stripeRefundable,
      hasStripe: ctx.hasStripe,
      limits: ctx.limits,
      invoicedElements: { invoices: elements },
    };
  };

  const itemsInvalid = (path: string) =>
    new EcommerceValidationError('Invalid refund', [{ path, code: 'REFUND_ITEMS_INVALID' }]);

  /**
   * The elements of an INVOICED refund (plan 15), each valued by the refund credit note's rule
   * (`refundCreditLine`) against what is available: live credit notes and the elements of other
   * active refunds are left out. Empty items, an unknown element, a DISCOUNT record, partial
   * shipping, a repeated element or more units than available are `REFUND_ITEMS_INVALID`.
   */
  const invoicedItems = async (orderId: number, state: OrderState, raw: unknown): Promise<RefundItem[]> => {
    if (!Array.isArray(raw) || !raw.length) throw itemsInvalid('items');
    const { targets } = await invoices().refundElements(orderId, state);
    const byId = new Map(targets.map((t) => [t.row.id, t]));
    const seen = new Set<string>();
    const items: RefundItem[] = [];
    raw.forEach((entry, i) => {
      const e: Record<string, unknown> = entry && typeof entry === 'object' ? (entry as any) : {};
      const target = byId.get(Number(e.invoiceId));
      const key = `${Number(e.invoiceId)}:${String(e.index)}`;
      if (!target || seen.has(key)) throw itemsInvalid(`items.${i}`);
      seen.add(key);
      const built = refundCreditLine(target.invoice, target.options, e.index, e.quantity);
      if ('issue' in built) throw itemsInvalid(`items.${i}`);
      items.push({ invoiceId: target.row.id, index: Number(e.index), quantity: built.quantity, value: built.value });
    });
    // Never more of an invoice than it still holds.
    for (const t of targets) {
      const value = items.filter((x) => x.invoiceId === t.row.id).reduce((s, x) => s + x.value, 0);
      if (value > t.options.held) throw itemsInvalid('items');
    }
    return items;
  };

  /** A removed INVOICED refund (CANCELLED, `metadata.removed`) is kept for the audit only. */
  const isRemoved = (r: any): boolean => r?.metadata?.removed === true;

  const list = async (rawOrderId: number | string): Promise<RefundView[]> => {
    const orderId = Number(rawOrderId);
    const order = await strapi.db
      .query(uids().order)
      .findOne({ where: { id: orderId }, select: ['id', 'orderStatus'] });
    if (!order) throw new EcommerceNotFoundError('Order not found');
    const rows = (await refundRows({ order: { id: orderId } })).filter((r) => !isRemoved(r));
    const views: RefundView[] = [];
    for (const row of rows) {
      const refusal = await removalRefusal(row, order.orderStatus);
      views.push({ ...toRefundView(row), removable: refusal === null });
    }
    return views;
  };

  /**
   * Refunds a key created, on any order: `key` itself, or `key:<paymentId>` for the STRIPE
   * allocation of that payment. Nothing else sharing the prefix matches (`cancel-credit:<id>`,
   * `key:abc`, …). A key already used on another order is a conflict.
   */
  const findByKey = async (orderId: number, key: string): Promise<any[]> => {
    const candidates: any[] = await strapi.db.query(uids().refund).findMany({
      where: { $or: [{ idempotencyKey: key }, { idempotencyKey: { $startsWith: `${key}:` } }] },
      populate: { order: { select: ['id'] }, payment: { select: ['id'] } },
    });
    const created = candidates.filter(
      (r) =>
        r.idempotencyKey === key ||
        (r.method === 'STRIPE' && r.idempotencyKey === `${key}:${idOf(r.payment)}`)
    );
    if (created.some((r) => idOf(r.order) !== orderId)) {
      throw invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT');
    }
    if (!created.length) return [];
    return refundRows({ id: { $in: created.map((r) => r.id) } });
  };

  // -------------------------------------------------------------------------
  // Stripe
  // -------------------------------------------------------------------------

  /**
   * Applies Stripe's answer to a PROCESSING refund (no-op once it left PROCESSING). A failure
   * reported on a Stripe refund object (`externalId` set) is Stripe's own: flagged
   * `stripeFailed` (final, never promoted back) with its `failure_reason`.
   */
  const applyStripeStatus = async (
    refundId: number,
    status: string,
    externalId: string | null,
    actor: string,
    collector: Collector,
    failureReason: string | null = null
  ): Promise<void> => {
    const u = uids();
    await strapi.db.transaction(async () => {
      const row = await rowById(refundId);
      if (!row) return;
      const orderId = idOf(row.order);
      if (orderId === null) return;
      await orders().lockOrder(orderId);
      const target =
        status === 'succeeded'
          ? 'COMPLETED'
          : status === 'failed' || status === 'canceled'
            ? 'FAILED'
            : 'PROCESSING';
      const data: Record<string, unknown> = {};
      if (externalId) data.externalId = externalId;
      if (target === 'COMPLETED') {
        data.status = 'COMPLETED';
        data.completedAt = new Date().toISOString();
      } else if (target === 'FAILED') {
        data.status = 'FAILED';
        if (externalId) {
          data.metadata = {
            ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
            stripeFailed: true,
            ...(failureReason && /^[a-z_]{1,64}$/.test(failureReason) ? { failureReason } : {}),
          };
        }
      }
      const { count } = await strapi.db
        .query(u.refund)
        .updateMany({ where: { id: refundId, status: 'PROCESSING' }, data });
      if (!count) return;
      const updated = { ...row, ...data };
      const operationId = randomUUID();
      if (target === 'COMPLETED') {
        await history().record({
          orderId,
          type: 'REFUND_COMPLETED',
          description: `Stripe refund of ${num(row.amount)} cents completed`,
          previousValue: null,
          newValue: historyValue(updated),
          actor,
          operationId,
        });
        await orders().recalculate(orderId, { actor, operationId });
        collector.emit({ type: 'REFUND_COMPLETED', orderId, payload: eventPayload(updated) });
      } else if (target === 'FAILED') {
        await history().record({
          orderId,
          type: 'REFUND_FAILED',
          description: `Stripe refund of ${num(row.amount)} cents failed`,
          previousValue: null,
          newValue: historyValue(updated),
          actor,
          operationId,
        });
        // An INVOICED refund that failed gives its credit adjustment back.
        if (row.scope === 'INVOICED') await orders().recalculate(orderId, { actor, operationId });
        collector.emit({ type: 'REFUND_FAILED', orderId, payload: eventPayload(updated) });
      } else if (externalId && !row.externalId) {
        // Only when Stripe first gives the refund its id: a refresh or resume of a refund that
        // already had one never re-announces it (each REFUND_STARTED e-mails the customer).
        collector.emit({ type: 'REFUND_STARTED', orderId, payload: eventPayload(updated) });
      }
    });
  };

  /**
   * Sends PROCESSING refunds without a Stripe id to Stripe (outside any transaction). The
   * Idempotency-Key derives from the refund's key, so a retry gets the same Stripe refund.
   * Only a definitive rejection (`isDefinitiveStripeRejection`: HTTP 400/402/404 with a Stripe
   * error) fails the refund. Any other error (409, 429, 5xx, unreachable) has an unknown
   * outcome: the refund stays PROCESSING and the error is rethrown after the others; `resume`
   * (or the same key) retries it, and the webhook settles it if Stripe did act.
   */
  const submitToStripe = async (orderId: number, rows: any[], actor: string): Promise<void> => {
    const pending = rows.filter((r) => r.method === 'STRIPE' && r.status === 'PROCESSING' && !r.externalId);
    if (!pending.length) return;
    const client = await stripeClient();
    if (!client) throw new EcommercePaymentError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    const collector = events().collector();
    let unknownOutcome: unknown = null;
    for (const r of pending) {
      const paymentIntentId = r.metadata?.paymentIntentId ?? paymentIntentOf(r.payment);
      if (!paymentIntentId) {
        // Never sent: nothing can have left Stripe.
        strapi.log?.warn(`[ecommerce] Stripe refund ${r.id} (order ${orderId}) has no PaymentIntent`);
        await applyStripeStatus(r.id, 'failed', null, actor, collector);
        continue;
      }
      try {
        const res = await client.createRefund({
          paymentIntentId,
          amount: num(r.amount),
          idempotencyKey: `refund:${r.idempotencyKey}`,
          metadata: {
            orderId: String(orderId),
            refundId: String(r.id),
            paymentId: String(idOf(r.payment) ?? ''),
          },
        });
        await applyStripeStatus(r.id, res.status, res.id, actor, collector);
      } catch (err) {
        if (isDefinitiveStripeRejection(err)) {
          strapi.log?.warn(`[ecommerce] Stripe rejected refund ${r.id} (order ${orderId}): ${errorLabel(err)}`);
          await applyStripeStatus(r.id, 'failed', null, actor, collector);
        } else {
          strapi.log?.error(`[ecommerce] Stripe refund ${r.id} (order ${orderId}) outcome unknown: ${errorLabel(err)}`);
          unknownOutcome = unknownOutcome ?? err;
        }
      }
    }
    await collector.flush();
    if (unknownOutcome) throw unknownOutcome;
  };

  /**
   * Re-sends a PROCESSING Stripe refund that has no Stripe id yet (its outcome was unknown),
   * with the Idempotency-Key, amount and payment stored on the row, and applies the answer
   * like `create`. Anything else is `REFUND_NOT_RESUMABLE` (a refund with a Stripe id is
   * settled by the webhook).
   */
  const resume = async (rawRefundId: number | string, actor: string): Promise<RefundView> => {
    const id = Number(rawRefundId);
    const row = await rowById(id);
    if (!row) throw new EcommerceNotFoundError('Refund not found');
    if (row.method !== 'STRIPE' || row.status !== 'PROCESSING' || row.externalId) {
      throw new EcommerceValidationError('Refund cannot be resumed', [
        { path: 'status', code: 'REFUND_NOT_RESUMABLE' },
      ]);
    }
    const orderId = idOf(row.order);
    if (orderId === null) throw new EcommerceNotFoundError('Order not found');
    await submitToStripe(orderId, [row], actor);
    return toRefundView(await rowById(id));
  };

  /**
   * Reads a PROCESSING Stripe refund that has a Stripe id back from Stripe (`GET /v1/refunds/:id`)
   * and applies its status like the webhook would: the way out when its events were lost.
   * Anything else is `REFUND_NOT_REFRESHABLE`.
   */
  const refresh = async (rawRefundId: number | string, actor: string): Promise<RefundView> => {
    const id = Number(rawRefundId);
    const row = await rowById(id);
    if (!row) throw new EcommerceNotFoundError('Refund not found');
    if (row.method !== 'STRIPE' || row.status !== 'PROCESSING' || !row.externalId) {
      throw new EcommerceValidationError('Refund cannot be refreshed', [
        { path: 'status', code: 'REFUND_NOT_REFRESHABLE' },
      ]);
    }
    const client = await stripeClient();
    if (!client) throw new EcommercePaymentError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    const remote = await client.retrieveRefund(row.externalId);
    const collector = events().collector();
    await applyStripeStatus(id, remote.status, row.externalId, actor, collector, remote.failureReason);
    await collector.flush();
    return toRefundView(await rowById(id));
  };

  /**
   * The admin attests (after checking the Stripe dashboard) that Stripe never created the
   * refund of a PROCESSING Stripe refund that has no Stripe id: it becomes FAILED and its
   * reserved amount is released. A later webhook reporting it succeeded still promotes it.
   */
  const markFailed = async (
    rawRefundId: number | string,
    actor: string,
    input: { note?: string } = {}
  ): Promise<RefundView> => {
    const id = Number(rawRefundId);
    const note = clean(input?.note);
    if (note.length > MAX_TEXT) throw invalid('note', 'too_long');
    const first = await rowById(id);
    if (!first) throw new EcommerceNotFoundError('Refund not found');
    const orderId = idOf(first.order);
    if (orderId === null) throw new EcommerceNotFoundError('Order not found');
    const operationId = randomUUID();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await rowById(id);
      if (!row || row.method !== 'STRIPE' || row.status !== 'PROCESSING' || row.externalId) {
        throw new EcommerceValidationError('Refund cannot be marked as failed', [
          { path: 'status', code: 'REFUND_NOT_MARKABLE' },
        ]);
      }
      const metadata = {
        ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
        failureReason: 'MARKED_FAILED',
        ...(note ? { failureNote: note } : {}),
      };
      const { count } = await strapi.db
        .query(uids().refund)
        .updateMany({ where: { id, status: 'PROCESSING', externalId: null }, data: { status: 'FAILED', metadata } });
      if (!count) {
        throw new EcommerceValidationError('Refund cannot be marked as failed', [
          { path: 'status', code: 'REFUND_NOT_MARKABLE' },
        ]);
      }
      await history().record({
        orderId,
        type: 'REFUND_FAILED',
        description: `Stripe refund of ${num(row.amount)} cents marked as failed by an admin${note ? `: ${note}` : ''}`,
        previousValue: { refundId: id, status: 'PROCESSING' },
        newValue: { ...historyValue({ ...row, status: 'FAILED' }), note: note || null },
        actor,
        operationId,
      });
      if (row.scope === 'INVOICED') await orders().recalculate(orderId, { actor, operationId });
    });
    const collector = events().collector();
    collector.emit({
      type: 'REFUND_FAILED',
      orderId,
      // Notifications ignore this source: the admin decides what the customer is told.
      payload: eventPayload({ ...first, status: 'FAILED' }, { source: 'ADMIN_MARKED' }),
    });
    await collector.flush();
    return toRefundView(await rowById(id));
  };

  /**
   * Gives `amount` of a STORE_CREDIT payment back as a COMPLETED STORE_CREDIT refund: onto the
   * credit it spent or, when that credit is VOID or expired, onto a new credit for the same
   * e-mail. Records the history and emits `REFUND_COMPLETED`; the caller recalculates.
   */
  const refundToCredit = async (p: {
    orderId: number;
    payment: any;
    storeCreditId: number;
    amount: number;
    data: { reason: string; description: string | null; actor: string };
    idempotencyKey: string;
    /** Absent: EXCESS (the schema default). */
    scope?: RefundScope;
    /** `null`: the refund's own `refund-restore:<refundId>`. */
    operationKey: string | null;
    /** Stored on the refund (INVOICED: its `items`). */
    metadata?: Record<string, unknown> | null;
    note: string;
    operationId: string;
    collector: { emit(e: any): void };
  }): Promise<any> => {
    const u = uids();
    const { orderId, amount, operationId, collector } = p;
    const actor = p.data.actor;
    const row = await strapi.db.query(u.refund).create({
      data: {
        order: orderId,
        payment: p.payment.id,
        method: 'STORE_CREDIT',
        kind: 'STORE_CREDIT',
        ...(p.scope ? { scope: p.scope } : {}),
        status: 'COMPLETED',
        amount,
        currency: 'EUR',
        reason: p.data.reason,
        description: p.data.description,
        reference: null,
        externalId: null,
        idempotencyKey: p.idempotencyKey,
        storeCredit: p.storeCreditId,
        actor,
        completedAt: new Date().toISOString(),
        metadata: p.metadata ?? null,
      },
    });
    const res = await storeCredits().restore(
      {
        storeCreditId: p.storeCreditId,
        amount,
        refundId: row.id,
        orderId,
        operationKey: p.operationKey ?? `refund-restore:${row.id}`,
        actor,
      },
      { collector }
    );
    let linked = row;
    if (res.reissuedFrom) {
      await strapi.db.query(u.refund).update({ where: { id: row.id }, data: { storeCredit: res.storeCreditId } });
      linked = { ...row, storeCredit: res.storeCreditId };
      await history().record({
        orderId,
        type: 'STORE_CREDIT_ISSUED',
        description: `Store credit ${maskStoreCreditCode(res.code)} of ${amount} cents issued: the original credit ${maskStoreCreditCode(res.reissuedFrom.code)} is void or expired${p.note}`,
        previousValue: { storeCreditId: res.reissuedFrom.id, code: maskStoreCreditCode(res.reissuedFrom.code) },
        newValue: { ...historyValue(linked), code: maskStoreCreditCode(res.code) },
        actor,
        operationId,
      });
    } else {
      await history().record({
        orderId,
        type: 'STORE_CREDIT_RESTORED',
        description: `${amount} cents restored to store credit ${maskStoreCreditCode(res.code) ?? p.storeCreditId}${p.note}`,
        previousValue: null,
        newValue: historyValue(linked),
        actor,
        operationId,
      });
    }
    await history().record({
      orderId,
      type: 'REFUND_COMPLETED',
      description: `Store credit refund of ${amount} cents completed${p.note}`,
      previousValue: null,
      newValue: historyValue(linked),
      actor,
      operationId,
    });
    collector.emit({
      type: 'REFUND_COMPLETED',
      orderId,
      payload: eventPayload(linked, res.reissuedFrom ? { code: res.code } : {}),
    });
    return linked;
  };

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  const create = async (
    rawOrderId: number | string,
    input: CreateRefundInput,
    actor: string
  ): Promise<RefundView[]> => {
    const orderId = Number(rawOrderId);
    const key = clean(input?.idempotencyKey);
    if (!key) throw invalid('idempotencyKey', 'required');
    if (RESERVED_KEY.test(key)) throw invalid('idempotencyKey', 'reserved');

    const replay = await findByKey(orderId, key);
    if (replay.length) {
      await submitToStripe(orderId, replay, actor);
      return (await refundRows({ id: { $in: replay.map((r) => r.id) } })).map(toRefundView);
    }

    const method = input?.method;
    if (!REFUND_METHODS.includes(method)) throw invalid('method', 'invalid_method');
    const scope: RefundScope = input?.scope == null ? 'EXCESS' : input.scope;
    if (!REFUND_SCOPES.includes(scope)) throw invalid('scope', 'invalid_scope');
    let amount = input?.amount as number;
    const reason = clean(input?.reason);
    const description = clean(input?.description) || null;
    const reference = clean(input?.reference) || null;
    if (reason.length > 255) throw invalid('reason', 'too_long');
    if (reference && reference.length > 255) throw invalid('reference', 'too_long');
    if (description && description.length > MAX_TEXT) throw invalid('description', 'too_long');
    const paymentId =
      input?.paymentId === undefined || input?.paymentId === null ? null : Number(input.paymentId);

    const collector = events().collector();
    const operationId = randomUUID();
    const u = uids();
    let created: any[];
    try {
      created = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        const state = await orders().computeOrderState(orderId);
        orders().assertAction(state, 'REFUND');
        // INVOICED (plan 15): the amount is the sum of the chosen elements.
        let items: RefundItem[] | null = null;
        if (scope === 'INVOICED') {
          items = await invoicedItems(orderId, state, input?.items);
          const sum = items.reduce((s, i) => s + i.value, 0);
          if (amount !== undefined && amount !== null && amount !== sum) {
            throw new EcommerceValidationError('Invalid refund', [
              { path: 'amount', code: 'REFUND_AMOUNT_DIFFERS', detail: String(sum) },
            ]);
          }
          amount = sum;
        }
        const own = items ? { items } : null;
        const limits = (await refundContext(state)).limits[scope];
        const issues = validateRefundRequest(
          { amount: amount as number, method, reason },
          {
            refundable: limits.refundable,
            stripeAvailable: limits.stripeRefundable,
            moneyRefundable: limits.moneyRefundable,
          }
        );
        if (issues.length) throw new EcommerceValidationError('Invalid refund', issues);

        const source =
          paymentId === null ? null : state.payments.find((p) => p.id === paymentId) ?? null;
        if (paymentId !== null && (!source || source.status !== 'COMPLETED')) {
          throw invalid('paymentId', 'invalid_payment');
        }

        const base = {
          order: orderId,
          method,
          scope,
          amount,
          currency: 'EUR',
          reason,
          description,
          reference: method === 'MANUAL_TRANSFER' ? reference : null,
          actor,
        };

        if (method === 'STRIPE') {
          const { allocations, unallocated } = allocateStripeRefund(amount, stripeSources(state));
          if (unallocated > 0) throw invalid('method', 'stripe_unavailable');
          // An INVOICED refund's elements belong to one refund row: never split across payments.
          if (own && allocations.length > 1) throw invalid('method', 'stripe_unavailable');
          const rows: any[] = [];
          for (const a of allocations) {
            const row = await strapi.db.query(u.refund).create({
              data: {
                ...base,
                amount: a.amount,
                payment: a.paymentId,
                kind: 'MONEY',
                status: 'PROCESSING',
                externalId: null,
                idempotencyKey: `${key}:${a.paymentId}`,
                storeCredit: null,
                completedAt: null,
                metadata: { paymentIntentId: a.paymentIntentId, ...(own ?? {}) },
              },
            });
            await history().record({
              orderId,
              type: 'REFUND_CREATED',
              description: `Stripe refund of ${a.amount} cents requested`,
              previousValue: null,
              newValue: historyValue(row),
              actor,
              operationId,
            });
            rows.push(row);
          }
          // An INVOICED refund lowers the total at once (it counts while PROCESSING).
          if (scope === 'INVOICED') await orders().recalculate(orderId, { actor, operationId });
          return rows;
        }

        const now = new Date().toISOString();
        if (method === 'MANUAL_TRANSFER') {
          if (source) {
            // Store credit goes back as store credit, never as money.
            if (source.method === 'STORE_CREDIT') throw invalid('paymentId', 'incompatible_payment');
            if (amount > num(source.amount) - heldOn(state.refunds, source.id)) {
              throw invalid('amount', 'exceeds_payment');
            }
          }
          const row = await strapi.db.query(u.refund).create({
            data: {
              ...base,
              payment: paymentId,
              kind: 'MONEY',
              status: 'COMPLETED',
              externalId: null,
              idempotencyKey: key,
              storeCredit: null,
              completedAt: now,
              metadata: own,
            },
          });
          await history().record({
            orderId,
            type: 'REFUND_COMPLETED',
            description: `Manual transfer refund of ${amount} cents registered`,
            previousValue: null,
            newValue: { ...historyValue(row), reference },
            actor,
            operationId,
          });
          await orders().recalculate(orderId, { actor, operationId });
          collector.emit({ type: 'REFUND_COMPLETED', orderId, payload: eventPayload(row) });
          return [row];
        }

        // STORE_CREDIT
        if (source && source.method === 'STORE_CREDIT') {
          // Back to the credit the payment spent.
          const storeCreditId = idOf(source.metadata?.storeCreditId);
          if (storeCreditId === null) throw invalid('paymentId', 'invalid_payment');
          if (amount > num(source.amount) - heldOn(state.refunds, source.id)) {
            throw invalid('amount', 'exceeds_payment');
          }
          const row = await refundToCredit({
            orderId,
            payment: source,
            storeCreditId,
            amount,
            data: { reason, description, actor },
            idempotencyKey: key,
            scope,
            operationKey: null,
            metadata: own,
            note: '',
            operationId,
            collector,
          });
          await orders().recalculate(orderId, { actor, operationId });
          return [row];
        }
        if (source) throw invalid('paymentId', 'invalid_payment');

        // A new credit for the customer.
        const customerId = idOf(state.order.customer);
        if (customerId === null) throw invalid('method', 'customer_not_found');
        const row = await strapi.db.query(u.refund).create({
          data: {
            ...base,
            payment: null,
            kind: 'STORE_CREDIT',
            status: 'COMPLETED',
            externalId: null,
            idempotencyKey: key,
            storeCredit: null,
            completedAt: now,
            metadata: own,
          },
        });
        const credit = await storeCredits().issue(
          {
            customerId,
            amount,
            expiresAt: input.expiresAt ?? null,
            conditions: input.conditions ?? null,
            sourceOrderId: orderId,
            sourceRefundId: row.id,
            actor,
            operationKey: `refund-credit:${row.id}`,
          },
          { collector }
        );
        await strapi.db.query(u.refund).update({ where: { id: row.id }, data: { storeCredit: credit.id } });
        const linked = { ...row, storeCredit: credit.id };
        await history().record({
          orderId,
          type: 'STORE_CREDIT_ISSUED',
          description: `Store credit ${maskStoreCreditCode(credit.code)} of ${amount} cents issued`,
          previousValue: null,
          newValue: { ...historyValue(linked), code: maskStoreCreditCode(credit.code), expiresAt: credit.expiresAt },
          actor,
          operationId,
        });
        await history().record({
          orderId,
          type: 'REFUND_COMPLETED',
          description: `Store credit refund of ${amount} cents completed`,
          previousValue: null,
          newValue: historyValue(linked),
          actor,
          operationId,
        });
        await orders().recalculate(orderId, { actor, operationId });
        collector.emit({
          type: 'REFUND_COMPLETED',
          orderId,
          payload: eventPayload(linked, { code: credit.code }),
        });
        return [linked];
      });
    } catch (err) {
      // A concurrent request with the same key committed first: its refunds are the answer.
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, key);
        if (winner.length) return winner.map(toRefundView);
      }
      throw err;
    }
    await collector.flush();
    await submitToStripe(orderId, created, actor);
    return (await refundRows({ id: { $in: created.map((r) => r.id) } })).map(toRefundView);
  };

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  /**
   * Gives the store credit an order spent back to its vouchers when the order is cancelled
   * (design 4.14): one COMPLETED STORE_CREDIT refund per STORE_CREDIT payment with an unrefunded
   * part, plus the matching RESTORE (`cancel-credit:<paymentId>`). Never more than the
   * refundable amount; a second call releases nothing. Joins the caller's transaction; with
   * `opts.collector` its events go there (the caller flushes after its commit).
   */
  const releaseStoreCreditOnCancel = async (
    rawOrderId: number | string,
    actor: string,
    opts: { collector?: { emit(e: any): void }; operationId?: string } = {}
  ): Promise<RefundView[]> => {
    const orderId = Number(rawOrderId);
    const own = opts.collector ? null : events().collector();
    const collector = opts.collector ?? (own as Collector);
    const operationId = opts.operationId ?? randomUUID();
    const released = await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const state = await orders().computeOrderState(orderId);
      if (state.order.orderStatus !== 'CANCELLED') return [];
      let available = refundableAmount(state.summary, state.inFlightRefunds);
      const rows: any[] = [];
      for (const p of state.payments) {
        if (p.method !== 'STORE_CREDIT' || p.status !== 'COMPLETED') continue;
        const key = `cancel-credit:${p.id}`;
        if (state.refunds.some((r) => r.idempotencyKey === key)) continue;
        const amount = Math.min(num(p.amount) - heldOn(state.refunds, p.id), available);
        if (amount <= 0) continue;
        const storeCreditId = idOf(p.metadata?.storeCreditId);
        if (storeCreditId === null) {
          strapi.log?.warn(`[ecommerce] store credit payment ${p.id} has no credit to restore`);
          continue;
        }
        const row = await refundToCredit({
          orderId,
          payment: p,
          storeCreditId,
          amount,
          data: { reason: 'CANCELLATION', description: null, actor },
          idempotencyKey: key,
          operationKey: key,
          note: ' (order cancelled)',
          operationId,
          collector,
        });
        available -= amount;
        rows.push(row);
      }
      if (rows.length) await orders().recalculate(orderId, { actor, operationId });
      return rows;
    });
    if (own) await own.flush();
    return released.map(toRefundView);
  };

  // -------------------------------------------------------------------------
  // Remove (plan 15)
  // -------------------------------------------------------------------------

  const notRemovable = (code: string) =>
    new EcommerceValidationError('Refund cannot be removed', [{ path: 'refund', code }]);

  /**
   * Why the store credit a STORE_CREDIT refund issued cannot be voided by removing the refund, or
   * null while it is unused (its whole value still on it, or written off whole by an earlier void).
   * A refund that gave value back onto an existing credit is not removable: voiding that credit
   * would take more than the refund gave. Reads only.
   */
  const unusedCreditRefusal = async (
    row: any
  ): Promise<{ code: string } | { creditId: number; voided: boolean }> => {
    const u = uids();
    const creditId = idOf(row.storeCredit);
    if (creditId === null) return { code: 'REFUND_NOT_REMOVABLE' };
    const credit = await strapi.db.query(u.storeCredit).findOne({
      where: { id: creditId },
      populate: { sourceRefund: { select: ['id'] } },
    });
    if (!credit || idOf(credit.sourceRefund) !== row.id) return { code: 'REFUND_NOT_REMOVABLE' };
    const amount = num(row.amount);
    if (credit.status === 'VOID') {
      return (await voidedWhole(creditId, amount)) ? { creditId, voided: true } : { code: 'STORE_CREDIT_USED' };
    }
    if (num(credit.balance) !== amount || num(credit.initialAmount) !== amount) {
      return { code: 'STORE_CREDIT_USED' };
    }
    return { creditId, voided: false };
  };

  /** Whether the credit's void wrote off exactly `amount`. */
  const voidedWhole = async (creditId: number, amount: number) => {
    const m = await strapi.db
      .query(uids().storeCreditMovement)
      .findOne({ where: { operationKey: `void:${creditId}` } });
    return !!m && num(m.amount) === -amount;
  };

  /** Voids the store credit a STORE_CREDIT refund issued, only while it is unused. */
  const voidUnusedCredit = async (row: any, actor: string): Promise<void> => {
    const check = await unusedCreditRefusal(row);
    if ('code' in check) throw notRemovable(check.code);
    if (check.voided) return;
    await storeCredits().void(check.creditId, actor);
    // A concurrent use between the check and the void: the void wrote off less (rolled back).
    if (!(await voidedWhole(check.creditId, num(row.amount)))) throw notRemovable('STORE_CREDIT_USED');
  };

  /**
   * Why `row` cannot be removed (the remove rules, in their order), or null when it can. Reads
   * only: a STORE_CREDIT refund's credit is checked, never voided.
   */
  const removalRefusal = async (row: any, orderStatus: unknown): Promise<string | null> => {
    if (!row || row.scope !== 'INVOICED' || row.status !== 'COMPLETED' || isRemoved(row)) {
      return 'REFUND_NOT_REMOVABLE';
    }
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    if (metadata.creditNoteId != null) return 'REFUND_HAS_CREDIT_NOTE';
    if (row.method === 'STRIPE') return 'REFUND_NOT_REMOVABLE';
    if (!orderStatus || orderStatus === 'ARCHIVED') return 'REFUND_NOT_REMOVABLE';
    if (row.method === 'STORE_CREDIT') {
      const check = await unusedCreditRefusal(row);
      if ('code' in check) return check.code;
    }
    return null;
  };

  /**
   * Removes an INVOICED refund (plan 15): only without a credit note, on an order not archived,
   * never a STRIPE one (that money really left), and for STORE_CREDIT only while the credit is
   * unused (it is voided). The refund stays as CANCELLED with `metadata.removed` (out of the
   * lists) and its credit adjustment comes off: the total goes back up.
   */
  const remove = async (rawRefundId: number | string, actor: string): Promise<RefundView> => {
    const id = Number(rawRefundId);
    const first = await rowById(id);
    if (!first) throw new EcommerceNotFoundError('Refund not found');
    const orderId = idOf(first.order);
    if (orderId === null) throw new EcommerceNotFoundError('Order not found');
    const operationId = randomUUID();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await rowById(id);
      const order = await strapi.db
        .query(uids().order)
        .findOne({ where: { id: orderId }, select: ['id', 'orderStatus'] });
      const refusal = await removalRefusal(row, order?.orderStatus);
      if (refusal) throw notRemovable(refusal);
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      if (row.method === 'STORE_CREDIT') await voidUnusedCredit(row, actor);
      const removedAt = new Date().toISOString();
      const { count } = await strapi.db.query(uids().refund).updateMany({
        where: { id, status: 'COMPLETED' },
        data: { status: 'CANCELLED', metadata: { ...metadata, removed: true, removedAt, removedBy: actor } },
      });
      if (!count) throw notRemovable('REFUND_NOT_REMOVABLE');
      await history().record({
        orderId,
        type: 'REFUND_REMOVED',
        description: `Refund of ${num(row.amount)} cents removed: the order total goes back up`,
        previousValue: { refundId: id, status: 'COMPLETED' },
        newValue: { ...historyValue(row), status: 'CANCELLED', removed: true },
        actor,
        operationId,
      });
      await orders().recalculate(orderId, { actor, operationId });
    });
    return toRefundView(await rowById(id));
  };

  return { preview, list, create, resume, refresh, markFailed, remove, releaseStoreCreditOnCancel };
};

export default EcommerceRefundService;
