import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommercePaymentError, EcommerceValidationError } from './errors';
import { str } from './providers/http';
import {
  createStripeClient,
  type RetrievedCheckoutSession,
  type StripeClient,
} from './providers/payments/stripeClient';
import { coverageFor } from './payments';
import type { DomainEventHandler, DomainEventType } from './events';
import type { OrderHistoryEntry } from './orderHistory';
import type { OrderState } from './orders';
import { PATH_RE, type ProviderRuntime } from './providers/registry';
import type { StoreSettings } from './settings';

export type StripeLinkPurpose = 'CHECKOUT' | 'SUPPLEMENTARY';

export type PaymentLink = {
  url: string;
  /** ISO date-time. */
  expiresAt: string;
  sessionId: string;
  /** Cents. */
  amount: number;
  reused: boolean;
};

/** 23h55m: just below Stripe's 24 h maximum. */
const SESSION_TTL_SEC = 23 * 3600 + 55 * 60;
/** A session closer than this to its expiry is replaced instead of reused. */
const REUSE_MIN_REMAINING_MS = 3600 * 1000;
/** PaymentIntent statuses of an asynchronous payment that will never be paid. */
const FAILED_INTENT = ['canceled', 'requires_payment_method'];
/** Each pass either returns, throws or settles/expires a session; this only bounds races. */
const MAX_PASSES = 4;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const isoFromUnix = (sec: number): string => new Date(sec * 1000).toISOString();

/** The exact `createCheckoutSession` parameters, kept on the reserved payment for retries. */
type StoredParams = {
  amount: number;
  currency: 'EUR';
  description: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
  metadata: Record<string, string>;
};

/**
 * True when Stripe definitively refused a session create: a 4xx answer other than 409 (same
 * Idempotency-Key in flight) and 429 (rate limit), and not an `idempotency_error`. Network
 * errors, 409, 429 and 5xx have an unknown outcome: the reserved payment is kept so a retry
 * with the same key returns the session Stripe may have created.
 */
const isDefinitiveCreateRejection = (err: unknown): boolean =>
  err instanceof EcommercePaymentError &&
  err.code === 'STRIPE_REQUEST_FAILED' &&
  typeof err.httpStatus === 'number' &&
  err.httpStatus >= 400 &&
  err.httpStatus < 500 &&
  err.httpStatus !== 409 &&
  err.httpStatus !== 429 &&
  err.stripeErrorType !== 'idempotency_error';

const notAvailable = () =>
  new EcommerceValidationError('Action not available', [
    { path: 'action', code: 'ACTION_NOT_AVAILABLE' },
  ]);

const DEFAULT_SUCCESS_PATH = '/checkout/success';
const DEFAULT_CANCEL_PATH = '/checkout/cancel';

/** Where Stripe sends the customer back to: the configured paths (or the defaults) on the storefront. */
export function stripeReturnUrls(
  storefrontUrl: string,
  runtime: ProviderRuntime,
  publicId: string
): { successUrl: string; cancelUrl: string } {
  const base = storefrontUrl.replace(/\/+$/, '');
  const pathOf = (key: string, fallback: string): string => {
    const value = runtime.config[key];
    return typeof value === 'string' && PATH_RE.test(value.trim()) ? value.trim() : fallback;
  };
  const query = `?order=${encodeURIComponent(publicId)}`;
  return {
    successUrl: `${base}${pathOf('paymentSuccessPath', DEFAULT_SUCCESS_PATH)}${query}`,
    cancelUrl: `${base}${pathOf('paymentCancelPath', DEFAULT_CANCEL_PATH)}${query}`,
  };
}

/**
 * Stripe Checkout payment links (design 4.6): one active session per amount due. Stripe calls
 * always happen outside database transactions; DB writes run in short transactions before and
 * after, and a call interrupted between them is reconciled by the next one (the pending payment
 * and its deterministic Idempotency-Key are reused, so Stripe returns the same session).
 */
const EcommerceStripePaymentService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    computeOrderState(orderId: number): Promise<OrderState>;
    recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
    lockOrder(orderId: number): Promise<void>;
  } => service('EcommerceOrderService');
  const settings = (): {
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
    getStoreSettings(): Promise<StoreSettings>;
  } => service('EcommerceSettingsService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): { emit(e: any): void; flush(): Promise<void> } } =>
    service('EcommerceEventBus');

  const loadStripe = async (): Promise<{ client: StripeClient; runtime: ProviderRuntime }> => {
    const rt = await settings().getRuntime('stripe');
    if (!rt || !rt.active || !str(rt, 'secretKey')) {
      throw new EcommercePaymentError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    }
    return { client: createStripeClient(rt), runtime: rt };
  };
  const stripeClient = async (): Promise<StripeClient> => (await loadStripe()).client;

  const sessionsOf = (orderId: number, status?: string): Promise<any[]> =>
    strapi.db.query(uids().stripeSession).findMany({
      where: status ? { order: { id: orderId }, status } : { order: { id: orderId } },
      populate: { payment: true },
      orderBy: { id: 'asc' },
    });

  /** Throws unless a link can be made for the order now; returns the amount due. */
  const assertLinkable = (state: OrderState, store: StoreSettings): number => {
    if (state.order.orderStatus !== 'OPEN') throw notAvailable();
    const due = state.summary.due;
    if (due <= 0) throw new EcommercePaymentError('NOTHING_DUE', 'Nothing is due.');
    if (!store.storefrontUrl) {
      throw new EcommercePaymentError('STOREFRONT_URL_MISSING', 'The storefront URL is not set.');
    }
    return due;
  };

  const toLink = (row: any, reused: boolean): PaymentLink => ({
    url: row.url,
    expiresAt: new Date(row.expiresAt).toISOString(),
    sessionId: row.sessionId,
    amount: num(row.amount),
    reused,
  });

  /**
   * Settles the session's payment from a session read from Stripe (or a webhook). Idempotent:
   * a payment that is already COMPLETED is left untouched. A `complete` session that is not
   * paid yet (asynchronous methods such as Multibanco) is marked COMPLETE and its payment stays
   * PENDING until Stripe confirms it.
   *
   * With `opts.collector` (a caller running its own enclosing transaction, e.g. the webhook),
   * the event goes into that collector and the caller flushes it after its commit.
   */
  const completeFromSession = async (
    sessionRow: { id: number },
    retrieved: RetrievedCheckoutSession,
    actor: string,
    opts: { collector?: { emit(e: any): void } } = {}
  ): Promise<{ completed: boolean }> => {
    const u = uids();
    const own = opts.collector ? null : events().collector();
    const collector = opts.collector ?? (own as { emit(e: any): void });
    const result = await strapi.db.transaction(async () => {
      const row = await strapi.db.query(u.stripeSession).findOne({
        where: { id: sessionRow.id },
        populate: { order: { select: ['id'] }, payment: true },
      });
      if (!row) return { completed: false };
      const orderId = idOf(row.order);
      if (orderId === null) return { completed: false };
      await orders().lockOrder(orderId);

      const paymentId = idOf(row.payment);
      const payment =
        paymentId === null
          ? null
          : await strapi.db.query(u.payment).findOne({ where: { id: paymentId } });
      // Never settle a payment from a session that is not the one stored for it.
      if (
        retrieved.id !== row.sessionId ||
        (payment && retrieved.amountTotal !== num(payment.amount))
      ) {
        strapi.log?.warn(
          `[ecommerce] Stripe session mismatch for stripe-session ${row.id} (payment ${paymentId ?? '-'})`
        );
        throw new EcommercePaymentError(
          'STRIPE_SESSION_MISMATCH',
          'The Stripe session does not match the stored payment.'
        );
      }

      const paymentIntentId = retrieved.paymentIntentId ?? row.paymentIntentId ?? null;
      if (retrieved.status === 'complete' && row.status !== 'COMPLETE') {
        await strapi.db
          .query(u.stripeSession)
          .update({ where: { id: row.id }, data: { status: 'COMPLETE', paymentIntentId } });
      }
      if (retrieved.paymentStatus !== 'paid') return { completed: false };
      if (!payment || payment.status === 'COMPLETED') return { completed: false };

      // Money Stripe confirms is always recorded, whatever the order's state now.
      const state = await orders().computeOrderState(orderId);
      const amount = num(payment.amount);
      const operationId = randomUUID();
      await strapi.db.query(u.payment).update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          externalId: paymentIntentId ?? payment.externalId ?? null,
          coverage: coverageFor(state, amount),
        },
      });
      await history().record({
        orderId,
        type: 'PAYMENT_COMPLETED',
        description: `Stripe payment of ${amount} cents completed`,
        previousValue: null,
        newValue: {
          paymentId: payment.id,
          method: 'STRIPE',
          amount,
          sessionId: row.sessionId,
          paymentIntentId,
        },
        actor,
        operationId,
      });
      await orders().recalculate(orderId, { actor, operationId });
      collector.emit({
        type: 'PAYMENT_COMPLETED',
        orderId,
        payload: {
          paymentId: payment.id,
          amount,
          method: 'STRIPE',
          reference: state.order.reference,
        },
      });
      return { completed: true };
    });
    if (own) await own.flush();
    return result;
  };

  /** Marks an expired session EXPIRED and cancels its still-PENDING payment. */
  const markExpired = async (orderId: number, row: any): Promise<void> => {
    const u = uids();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      await strapi.db
        .query(u.stripeSession)
        .updateMany({ where: { id: row.id, status: 'OPEN' }, data: { status: 'EXPIRED' } });
      const paymentId = idOf(row.payment);
      if (paymentId !== null) {
        await strapi.db.query(u.payment).updateMany({
          where: { id: paymentId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      }
    });
  };

  /**
   * An awaiting (COMPLETE, unpaid) session whose PaymentIntent failed: the session is closed
   * (EXPIRED) and its PENDING payment FAILED, as `checkout.session.async_payment_failed` does.
   */
  const markAsyncFailed = async (orderId: number, row: any, intentStatus: string): Promise<void> => {
    const u = uids();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const { count } = await strapi.db
        .query(u.stripeSession)
        .updateMany({ where: { id: row.id, status: 'COMPLETE' }, data: { status: 'EXPIRED' } });
      if (!count) return;
      const paymentId = idOf(row.payment);
      if (paymentId === null) return;
      const { count: moved } = await strapi.db.query(u.payment).updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      if (!moved) return;
      await history().record({
        orderId,
        type: 'PAYMENT_FAILED',
        description: `Stripe payment failed (PaymentIntent ${intentStatus})`,
        previousValue: { paymentId, status: 'PENDING' },
        newValue: { paymentId, status: 'FAILED', sessionId: row.sessionId },
        actor: 'system',
      });
    });
  };

  /**
   * Stripe does not know the session with the current keys (404): it belongs to another account,
   * e.g. after the Stripe keys were changed in the settings. It can never be paid through this
   * account, so it is closed locally only.
   */
  const unknownToAccount = (err: unknown): boolean =>
    err instanceof EcommercePaymentError &&
    err.code === 'STRIPE_REQUEST_FAILED' &&
    err.httpStatus === 404;

  /** Expires a stale OPEN session at Stripe, or settles it if it was actually paid. */
  const retire = async (client: StripeClient, orderId: number, row: any): Promise<void> => {
    let status: 'expired' | 'complete';
    try {
      status = await client.expireCheckoutSession(row.sessionId);
    } catch (err) {
      if (unknownToAccount(err)) return markExpired(orderId, row);
      throw err;
    }
    if (status === 'expired') return markExpired(orderId, row);
    // `complete`: paid before the webhook arrived (or awaiting an asynchronous method).
    const retrieved = await client.retrieveCheckoutSession(row.sessionId);
    await completeFromSession(row, retrieved, 'system');
  };

  const getOrCreatePaymentLink = async (
    rawOrderId: number | string,
    opts: { purpose?: StripeLinkPurpose; actor: string }
  ): Promise<PaymentLink> => {
    const orderId = Number(rawOrderId);
    const actor = opts?.actor ?? 'system';
    const { client, runtime } = await loadStripe();
    const store = await settings().getStoreSettings();
    const u = uids();

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const state = await orders().computeOrderState(orderId);
      const due = assertLinkable(state, store);
      // Not given: SUPPLEMENTARY once a payment has been completed, else CHECKOUT.
      const purpose: StripeLinkPurpose =
        (opts?.purpose ?? (state.payments.some((p) => p.status === 'COMPLETED') ? 'SUPPLEMENTARY' : 'CHECKOUT')) ===
        'SUPPLEMENTARY'
          ? 'SUPPLEMENTARY'
          : 'CHECKOUT';

      // A completed-but-unpaid session (e.g. Multibanco reference) may still be paid: a second
      // link could charge the customer twice. If Stripe says it is paid by now, settle it.
      const awaiting = (await sessionsOf(orderId, 'COMPLETE')).filter(
        (s) => s.payment && s.payment.status === 'PENDING'
      );
      if (awaiting.length) {
        for (const row of awaiting) {
          const retrieved = await client.retrieveCheckoutSession(row.sessionId);
          if (retrieved.paymentStatus === 'paid') {
            await completeFromSession(row, retrieved, 'system');
            continue;
          }
          // A `complete` session never expires: the PaymentIntent says whether the asynchronous
          // payment failed (its `async_payment_failed` event may have been lost) or succeeded.
          const piId = retrieved.paymentIntentId ?? row.paymentIntentId ?? null;
          const intent = piId ? await client.retrievePaymentIntent(piId) : null;
          if (intent && FAILED_INTENT.includes(intent.status)) {
            await markAsyncFailed(orderId, row, intent.status);
            continue;
          }
          if (intent && intent.status === 'succeeded') {
            await completeFromSession(
              row,
              { ...retrieved, paymentStatus: 'paid', paymentIntentId: intent.id },
              'system'
            );
            continue;
          }
          throw new EcommercePaymentError('PAYMENT_PENDING', 'A Stripe payment awaits confirmation.');
        }
        continue; // re-read: the due changed
      }

      const open = await sessionsOf(orderId, 'OPEN');
      const reusable = open.find(
        (s) =>
          num(s.amount) === due &&
          new Date(s.expiresAt).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
      );
      // Retire every OPEN session except the reusable one: one live link per order.
      const stale = open.filter((s) => s !== reusable);
      if (reusable && !stale.length) {
        // Confirm it with the current keys before handing it out again: after a change of Stripe
        // account the stored link points to the old account.
        let current: RetrievedCheckoutSession | null = null;
        try {
          current = await client.retrieveCheckoutSession(reusable.sessionId);
        } catch (err) {
          if (!unknownToAccount(err)) throw err;
        }
        if (current?.status === 'open') return toLink(reusable, true);
        if (current?.status === 'complete') await completeFromSession(reusable, current, 'system');
        else await markExpired(orderId, reusable);
        continue; // re-read: the due may have changed
      }
      if (stale.length) {
        for (const row of stale) await retire(client, orderId, row);
        continue; // re-read: a paid session may have changed the due
      }

      // Short transaction: reserve (or reuse) the PENDING payment that the session will settle.
      const reserved = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        const fresh = await orders().computeOrderState(orderId);
        const freshDue = assertLinkable(fresh, store);
        if (freshDue !== due) return null;
        const openNow = await strapi.db
          .query(u.stripeSession)
          .count({ where: { order: { id: orderId }, status: 'OPEN' } });
        if (openNow > 0) return null; // a concurrent request created one: start over

        const stripePayments = fresh.payments.filter((p) => p.method === 'STRIPE');
        // A previous attempt that never got its session stored (Stripe or DB failure).
        const orphans = stripePayments.filter((p) => p.status === 'PENDING' && !p.externalId);
        const minExpiry = Math.floor((Date.now() + REUSE_MIN_REMAINING_MS) / 1000);
        let payment = orphans.find(
          (p) =>
            num(p.amount) === due &&
            p.metadata?.purpose === purpose &&
            num(p.metadata?.stripeParams?.expiresAt) > minExpiry &&
            typeof p.metadata?.stripeIdempotencyKey === 'string'
        );
        for (const p of orphans) {
          if (p === payment) continue;
          await strapi.db
            .query(u.payment)
            .updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        }
        if (!payment) {
          // n = session attempts already made for this order (one STRIPE payment each).
          const n = stripePayments.length;
          const stripeIdempotencyKey = `session:${orderId}:${due}:${n}`;
          const created = await strapi.db.query(u.payment).create({
            data: {
              order: orderId,
              method: 'STRIPE',
              status: 'PENDING',
              amount: due,
              currency: 'EUR',
              reference: null,
              externalId: null,
              idempotencyKey: `stripe:${stripeIdempotencyKey}`,
              coverage: null,
              completedAt: null,
              actor,
              metadata: null,
            },
          });
          // The exact create parameters are stored: a retry with the same Idempotency-Key must
          // send identical ones, or Stripe rejects it.
          const { order } = fresh;
          const { successUrl, cancelUrl } = stripeReturnUrls(String(store.storefrontUrl), runtime, order.publicId);
          const email = order.customerSnapshot?.email;
          const stripeParams: StoredParams = {
            amount: due,
            currency: 'EUR',
            description: `Order #${order.reference}`,
            customerEmail: typeof email === 'string' && email ? email : null,
            successUrl,
            cancelUrl,
            expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
            metadata: { orderId: String(orderId), paymentId: String(created.id), purpose },
          };
          const metadata = { purpose, stripeIdempotencyKey, stripeParams };
          await strapi.db
            .query(u.payment)
            .update({ where: { id: created.id }, data: { metadata } });
          payment = { ...created, metadata };
        }
        return { payment };
      });
      if (!reserved) continue;

      const { payment } = reserved;
      const params: StoredParams = payment.metadata.stripeParams;
      let session: Awaited<ReturnType<StripeClient['createCheckoutSession']>>;
      try {
        session = await client.createCheckoutSession({
          ...params,
          customerEmail: params.customerEmail ?? undefined,
          idempotencyKey: payment.metadata.stripeIdempotencyKey,
        });
      } catch (err) {
        const abandon = () =>
          strapi.db.transaction(async () => {
            await orders().lockOrder(orderId);
            await strapi.db.query(u.payment).updateMany({
              where: { id: payment.id, status: 'PENDING', externalId: null },
              data: { status: 'CANCELLED' },
            });
          });
        // The key was used with other parameters: abandon it, the next pass uses n + 1.
        if (err instanceof EcommercePaymentError && err.stripeErrorType === 'idempotency_error') {
          await abandon();
          continue;
        }
        // Stripe definitively refused (e.g. 401 bad key): no session exists, so the reserved
        // payment would only linger as an orphan. Transient outcomes keep it for a retry.
        if (isDefinitiveCreateRejection(err)) await abandon();
        throw err;
      }

      const stored = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        let row = await strapi.db
          .query(u.stripeSession)
          .findOne({ where: { sessionId: session.id } });
        if (!row) {
          // Stored even when stale below, so the session is tracked and can be retired.
          row = await strapi.db.query(u.stripeSession).create({
            data: {
              order: orderId,
              payment: payment.id,
              sessionId: session.id,
              paymentIntentId: session.paymentIntentId,
              url: session.url,
              amount: params.amount,
              status: 'OPEN',
              expiresAt: isoFromUnix(session.expiresAt),
              purpose,
            },
          });
          await strapi.db
            .query(u.payment)
            .update({ where: { id: payment.id }, data: { externalId: session.id } });
          await history().record({
            orderId,
            type: 'PAYMENT_CREATED',
            description: 'Stripe payment link created',
            previousValue: null,
            newValue: {
              paymentId: payment.id,
              method: 'STRIPE',
              amount: params.amount,
              sessionId: session.id,
              purpose,
            },
            actor,
          });
        }
        // While Stripe was creating the session the order may have changed (a payment, a
        // modification, a concurrent link): only a session for the current due is handed out.
        const current = await strapi.db.query(u.payment).findOne({ where: { id: payment.id } });
        const fresh = await orders().computeOrderState(orderId);
        const stale =
          row.status !== 'OPEN' ||
          !current ||
          current.status !== 'PENDING' ||
          fresh.order.orderStatus !== 'OPEN' ||
          fresh.summary.due !== num(row.amount);
        return { row, stale };
      });
      if (!stored.stale) return toLink(stored.row, false);
      if (stored.row.status === 'OPEN') {
        await retire(client, orderId, { ...stored.row, payment: payment.id });
      }
    }
    // Only reachable when concurrent writers keep changing the order.
    throw new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'Could not create a payment link.');
  };

  /**
   * Retires every OPEN session of the order (used after a cancel commits): expired at Stripe,
   * the row EXPIRED and its PENDING payment CANCELLED; a session Stripe reports `complete` is
   * settled from the retrieved session instead. Each session is independent: a failure is
   * logged and the others are still retired.
   */
  const expireOpenSessions = async (rawOrderId: number | string): Promise<void> => {
    const orderId = Number(rawOrderId);
    const open = await sessionsOf(orderId, 'OPEN');
    if (!open.length) return;
    const client = await stripeClient();
    for (const row of open) {
      try {
        await retire(client, orderId, row);
      } catch (err) {
        const label =
          err instanceof EcommercePaymentError ? `${err.name}:${err.code}` : err instanceof Error ? err.name : typeof err;
        strapi.log?.error(
          `[ecommerce] could not expire Stripe session of stripe-session ${row.id} (order ${orderId}): ${label}`
        );
      }
    }
  };

  /**
   * After the amount due changed (a payment, an edit, a refund, a return): retires every OPEN
   * session whose amount is no longer the due (all of them when nothing is due), as
   * `expireOpenSessions` does; a session for the current due is kept. Does nothing when Stripe
   * is not configured. Each session is independent: a failure is logged (order id and error
   * name only) and the others are still retired. The state is re-read after each retirement,
   * since settling a session that was actually paid changes the due.
   */
  const retireOutdatedSessions = async (rawOrderId: number | string): Promise<void> => {
    const orderId = Number(rawOrderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return;
    if (!(await sessionsOf(orderId, 'OPEN')).length) return;
    const rt = await settings().getRuntime('stripe');
    if (!rt || !rt.active || !str(rt, 'secretKey')) return;
    const client = createStripeClient(rt);
    // Every session is tried at most once: a failed one (or one Stripe leaves open) is not retried.
    const tried = new Set<number>();
    for (;;) {
      const open = (await sessionsOf(orderId, 'OPEN')).filter((s) => !tried.has(s.id));
      if (!open.length) return;
      const { due } = (await orders().computeOrderState(orderId)).summary;
      const row = open.find((s) => num(s.amount) !== due);
      if (!row) return;
      tried.add(row.id);
      try {
        await retire(client, orderId, row);
      } catch (err) {
        const name = err instanceof Error ? err.name : typeof err;
        strapi.log?.error(
          `[ecommerce] could not retire an outdated Stripe session of order ${orderId}: ${name}`
        );
      }
    }
  };

  /**
   * True when a Checkout Session of the order is COMPLETE and its STRIPE payment still PENDING:
   * an asynchronous method (e.g. Multibanco) awaiting confirmation. The order view does not
   * carry session states, so the storefront status reads it here.
   */
  const hasPendingCompletedStripeSession = async (rawOrderId: number | string): Promise<boolean> => {
    const orderId = Number(rawOrderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return false;
    const complete = await sessionsOf(orderId, 'COMPLETE');
    return complete.some(
      (s) => s.payment && s.payment.method === 'STRIPE' && s.payment.status === 'PENDING'
    );
  };

  return {
    getOrCreatePaymentLink,
    completeFromSession,
    expireOpenSessions,
    retireOutdatedSessions,
    hasPendingCompletedStripeSession,
  };
};

/** Domain events after which the amount due may have changed (cancellation is handled apart). */
export const DUE_CHANGING_EVENTS: DomainEventType[] = [
  'PAYMENT_COMPLETED',
  'ORDER_MODIFIED',
  'REFUND_COMPLETED',
  'REFUND_FAILED',
  'RETURN_REGISTERED',
];

/**
 * Subscribes the retirement of outdated payment links to the domain events that change the
 * amount due (from `bootstrap`). Runs after the commit; never throws: a failure is logged with
 * the order id and the error name only and never undoes the operation. Retiring emits no event
 * of its own; settling a session Stripe reports paid emits PAYMENT_COMPLETED, which re-enters
 * here and only sees the sessions still OPEN.
 */
export function subscribeStripeSessionRetirement(strapi: Core.Strapi): void {
  const handler: DomainEventHandler = async (event) => {
    const orderId = event.orderId;
    if (orderId === undefined || orderId === null) return;
    try {
      await strapi
        .plugin(PLUGIN_ID)
        .service('EcommerceStripePaymentService')
        .retireOutdatedSessions(orderId);
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      strapi.log?.error?.(
        `[ecommerce] could not retire the outdated Stripe sessions of order ${orderId}: ${name}`
      );
    }
  };
  const bus = strapi.plugin(PLUGIN_ID).service('EcommerceEventBus');
  for (const type of DUE_CHANGING_EVENTS) bus.subscribe(type, handler);
}

export default EcommerceStripePaymentService;
