import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommercePaymentError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { str } from './providers/http';
import { createStripeClient, type StripeClient } from './providers/payments/stripeClient';
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
    restore(input: RestoreStoreCreditInput): Promise<{ applied: boolean }>;
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

  /** Refunds a key created: `key` itself, or `key:<paymentId>` for Stripe allocations. */
  const findByKey = async (orderId: number, key: string): Promise<any[]> => {
    const same = await strapi.db.query(uids().refund).findOne({
      where: { idempotencyKey: key },
      populate: { order: { select: ['id'] } },
    });
    if (same && idOf(same.order) !== orderId) throw invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT');
    const rows = await refundRows({ order: { id: orderId } });
    return rows.filter(
      (r) =>
        typeof r.idempotencyKey === 'string' &&
        (r.idempotencyKey === key || r.idempotencyKey.startsWith(`${key}:`))
    );
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
   * A rejection (HTTP error) fails the refund; an unknown outcome (unreachable) leaves it
   * PROCESSING and is rethrown after the others: repeating the request resumes it.
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
      try {
        if (!paymentIntentId) {
          throw new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'No PaymentIntent to refund.');
        }
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
        if (err instanceof EcommercePaymentError && err.code === 'STRIPE_REQUEST_FAILED') {
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
          const row = await strapi.db.query(u.refund).create({
            data: {
              ...base,
              payment: source.id,
              kind: 'STORE_CREDIT',
              status: 'COMPLETED',
              externalId: null,
              idempotencyKey: key,
              storeCredit: storeCreditId,
              completedAt: now,
              metadata: null,
            },
          });
          await storeCredits().restore({
            storeCreditId,
            amount,
            refundId: row.id,
            orderId,
            operationKey: `refund-restore:${row.id}`,
            actor,
          });
          await history().record({
            orderId,
            type: 'STORE_CREDIT_RESTORED',
            description: `${amount} cents restored to store credit ${source.metadata?.code ?? storeCreditId}`,
            previousValue: null,
            newValue: historyValue(row),
            actor,
            operationId,
          });
          await history().record({
            orderId,
            type: 'REFUND_COMPLETED',
            description: `Store credit refund of ${amount} cents completed`,
            previousValue: null,
            newValue: historyValue(row),
            actor,
            operationId,
          });
          await orders().recalculate(orderId, { actor, operationId });
          collector.emit({ type: 'REFUND_COMPLETED', orderId, payload: eventPayload(row) });
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
    const u = uids();
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
        const row = await strapi.db.query(u.refund).create({
          data: {
            order: orderId,
            payment: p.id,
            method: 'STORE_CREDIT',
            kind: 'STORE_CREDIT',
            status: 'COMPLETED',
            amount,
            currency: 'EUR',
            reason: 'CANCELLATION',
            description: null,
            reference: null,
            externalId: null,
            idempotencyKey: key,
            storeCredit: storeCreditId,
            actor,
            completedAt: new Date().toISOString(),
            metadata: null,
          },
        });
        await storeCredits().restore({
          storeCreditId,
          amount,
          refundId: row.id,
          orderId,
          operationKey: key,
          actor,
        });
        await history().record({
          orderId,
          type: 'STORE_CREDIT_RESTORED',
          description: `${amount} cents restored to store credit ${p.metadata?.code ?? storeCreditId} (order cancelled)`,
          previousValue: null,
          newValue: historyValue(row),
          actor,
          operationId,
        });
        await history().record({
          orderId,
          type: 'REFUND_COMPLETED',
          description: `Store credit refund of ${amount} cents completed (order cancelled)`,
          previousValue: null,
          newValue: historyValue(row),
          actor,
          operationId,
        });
        collector.emit({ type: 'REFUND_COMPLETED', orderId, payload: eventPayload(row) });
        available -= amount;
        rows.push(row);
      }
      if (rows.length) await orders().recalculate(orderId, { actor, operationId });
      return rows;
    });
    if (own) await own.flush();
    return released.map(toRefundView);
  };

  return { preview, list, create, releaseStoreCreditOnCancel };
};

export default EcommerceRefundService;
