import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommercePaymentError, EcommerceValidationError } from './errors';
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
  refundableAmount,
  validateRefundRequest,
  type RefundSource,
} from './domain/refunds';
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

export type CreateRefundInput = {
  method: RefundMethod;
  /** Integer cents > 0, at most the refundable amount. */
  amount: number;
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
  storeCredit: { id: number; code: string } | null;
};

export type RefundPreview = {
  orderTotal: number;
  received: number;
  refunded: number;
  inFlight: number;
  refundable: number;
  stripeRefundable: number;
  hasStripe: boolean;
};

type Collector = { emit(e: any): void; flush(): Promise<void> };

const IN_FLIGHT = ['PENDING', 'PROCESSING'];
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

export const toRefundView = (r: any): RefundView => {
  const p = r.payment && typeof r.payment === 'object' ? r.payment : null;
  const sc = r.storeCredit && typeof r.storeCredit === 'object' ? r.storeCredit : null;
  return {
    id: r.id,
    method: r.method,
    kind: r.kind,
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
          reference: p.reference ?? null,
          externalId: p.externalId ?? null,
        }
      : null,
    storeCredit: sc ? { id: sc.id, code: sc.code } : null,
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
  } => service('EcommerceStoreCreditService');
  const settings = (): {
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
  } => service('EcommerceSettingsService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');

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
  });

  const refundContext = async (state: OrderState) => {
    const refundable = refundableAmount(state.summary, state.inFlightRefunds);
    const capacity = stripeCapacity(state);
    const stripeActive = !!(await stripeClient());
    const hasStripe = stripeActive && capacity > 0;
    return { refundable, hasStripe, stripeRefundable: hasStripe ? Math.min(refundable, capacity) : 0 };
  };

  const preview = async (rawOrderId: number | string): Promise<RefundPreview> => {
    const state = await orders().computeOrderState(Number(rawOrderId));
    const ctx = await refundContext(state);
    return {
      orderTotal: state.summary.orderTotal,
      received: state.summary.paid,
      refunded: state.summary.refunded,
      inFlight: state.inFlightRefunds,
      refundable: ctx.refundable,
      stripeRefundable: ctx.stripeRefundable,
      hasStripe: ctx.hasStripe,
    };
  };

  const list = async (rawOrderId: number | string): Promise<RefundView[]> => {
    const orderId = Number(rawOrderId);
    const order = await strapi.db.query(uids().order).findOne({ where: { id: orderId }, select: ['id'] });
    if (!order) throw new EcommerceNotFoundError('Order not found');
    return (await refundRows({ order: { id: orderId } })).map(toRefundView);
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

  /** Applies Stripe's answer to a PROCESSING refund (no-op once it left PROCESSING). */
  const applyStripeStatus = async (
    refundId: number,
    status: string,
    externalId: string | null,
    actor: string,
    collector: Collector
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
        collector.emit({ type: 'REFUND_FAILED', orderId, payload: eventPayload(updated) });
      } else {
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
    /** `null`: the refund's own `refund-restore:<refundId>`. */
    operationKey: string | null;
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
        metadata: null,
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
        description: `Store credit ${res.code} of ${amount} cents issued: the original credit ${res.reissuedFrom.code} is void or expired${p.note}`,
        previousValue: { storeCreditId: res.reissuedFrom.id, code: res.reissuedFrom.code },
        newValue: { ...historyValue(linked), code: res.code },
        actor,
        operationId,
      });
    } else {
      await history().record({
        orderId,
        type: 'STORE_CREDIT_RESTORED',
        description: `${amount} cents restored to store credit ${res.code || p.storeCreditId}${p.note}`,
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
    const amount = input?.amount;
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
        const ctx = await refundContext(state);
        const issues = validateRefundRequest(
          { amount: amount as number, method, reason },
          { refundable: ctx.refundable, stripeAvailable: ctx.stripeRefundable }
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
                metadata: { paymentIntentId: a.paymentIntentId },
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
              metadata: null,
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
            operationKey: null,
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
            metadata: null,
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
          description: `Store credit ${credit.code} of ${amount} cents issued`,
          previousValue: null,
          newValue: { ...historyValue(linked), code: credit.code, expiresAt: credit.expiresAt },
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

  return { preview, list, create, resume, releaseStoreCreditOnCancel };
};

export default EcommerceRefundService;
