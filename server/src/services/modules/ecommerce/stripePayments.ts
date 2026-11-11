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
import type { OrderHistoryEntry } from './orderHistory';
import type { OrderState } from './orders';
import type { ProviderRuntime } from './providers/registry';
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
/** Each pass either returns, throws or settles/expires a session; this only bounds races. */
const MAX_PASSES = 4;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const isoFromUnix = (sec: number): string => new Date(sec * 1000).toISOString();

const notAvailable = () =>
  new EcommerceValidationError('Action not available', [
    { path: 'action', code: 'ACTION_NOT_AVAILABLE' },
  ]);

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

  const stripeClient = async (): Promise<StripeClient> => {
    const rt = await settings().getRuntime('stripe');
    if (!rt || !rt.active || !str(rt, 'secretKey')) {
      throw new EcommercePaymentError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    }
    return createStripeClient(rt);
  };

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
   */
  const completeFromSession = async (
    sessionRow: { id: number },
    retrieved: RetrievedCheckoutSession,
    actor: string
  ): Promise<{ completed: boolean }> => {
    const u = uids();
    const collector = events().collector();
    const result = await strapi.db.transaction(async () => {
      const row = await strapi.db.query(u.stripeSession).findOne({
        where: { id: sessionRow.id },
        populate: { order: { select: ['id'] }, payment: true },
      });
      if (!row) return { completed: false };
      const orderId = idOf(row.order);
      if (orderId === null) return { completed: false };
      await orders().lockOrder(orderId);

      const paymentIntentId = retrieved.paymentIntentId ?? row.paymentIntentId ?? null;
      if (retrieved.status === 'complete' && row.status !== 'COMPLETE') {
        await strapi.db
          .query(u.stripeSession)
          .update({ where: { id: row.id }, data: { status: 'COMPLETE', paymentIntentId } });
      }
      if (retrieved.paymentStatus !== 'paid') return { completed: false };

      const paymentId = idOf(row.payment);
      if (paymentId === null) return { completed: false };
      const payment = await strapi.db.query(u.payment).findOne({ where: { id: paymentId } });
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
    await collector.flush();
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
        await strapi.db
          .query(u.payment)
          .updateMany({
            where: { id: paymentId, status: 'PENDING' },
            data: { status: 'CANCELLED' },
          });
      }
    });
  };

  /** Expires a stale OPEN session at Stripe, or settles it if it was actually paid. */
  const retire = async (client: StripeClient, orderId: number, row: any): Promise<void> => {
    const status = await client.expireCheckoutSession(row.sessionId);
    if (status === 'expired') return markExpired(orderId, row);
    // `complete`: paid before the webhook arrived (or awaiting an asynchronous method).
    const retrieved = await client.retrieveCheckoutSession(row.sessionId);
    await completeFromSession(row, retrieved, 'system');
  };

  const getOrCreatePaymentLink = async (
    rawOrderId: number | string,
    opts: { purpose: StripeLinkPurpose; actor: string }
  ): Promise<PaymentLink> => {
    const orderId = Number(rawOrderId);
    const purpose: StripeLinkPurpose =
      opts?.purpose === 'SUPPLEMENTARY' ? 'SUPPLEMENTARY' : 'CHECKOUT';
    const actor = opts?.actor ?? 'system';
    const client = await stripeClient();
    const store = await settings().getStoreSettings();
    const u = uids();

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const state = await orders().computeOrderState(orderId);
      const due = assertLinkable(state, store);

      // A completed-but-unpaid session (e.g. Multibanco reference) may still be paid: a second
      // link could charge the customer twice.
      const awaiting = (await sessionsOf(orderId, 'COMPLETE')).some(
        (s) => s.payment && s.payment.status === 'PENDING'
      );
      if (awaiting) {
        throw new EcommercePaymentError('PAYMENT_PENDING', 'A Stripe payment awaits confirmation.');
      }

      const open = await sessionsOf(orderId, 'OPEN');
      const reusable = open.find(
        (s) =>
          num(s.amount) === due &&
          new Date(s.expiresAt).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
      );
      if (reusable) return toLink(reusable, true);
      if (open.length) {
        for (const row of open) await retire(client, orderId, row);
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
            num(p.metadata?.expiresAt) > minExpiry &&
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
          payment = await strapi.db.query(u.payment).create({
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
              metadata: {
                purpose,
                stripeIdempotencyKey,
                expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
              },
            },
          });
        }
        return { payment, order: fresh.order };
      });
      if (!reserved) continue;

      const { payment, order } = reserved;
      const base = String(store.storefrontUrl).replace(/\/+$/, '');
      const query = `?order=${encodeURIComponent(order.publicId)}`;
      const email = order.customerSnapshot?.email;
      // Identical parameters on a retry, so Stripe replays the same session for the same key.
      const session = await client.createCheckoutSession({
        amount: due,
        currency: 'EUR',
        description: `Order #${order.reference}`,
        customerEmail: typeof email === 'string' && email ? email : undefined,
        successUrl: `${base}${store.paymentSuccessPath}${query}`,
        cancelUrl: `${base}${store.paymentCancelPath}${query}`,
        expiresAt: num(payment.metadata.expiresAt),
        metadata: { orderId: String(orderId), paymentId: String(payment.id), purpose },
        idempotencyKey: payment.metadata.stripeIdempotencyKey,
      });

      const row = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        const existing = await strapi.db
          .query(u.stripeSession)
          .findOne({ where: { sessionId: session.id } });
        if (existing) return existing;
        const created = await strapi.db.query(u.stripeSession).create({
          data: {
            order: orderId,
            payment: payment.id,
            sessionId: session.id,
            paymentIntentId: session.paymentIntentId,
            url: session.url,
            amount: due,
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
            amount: due,
            sessionId: session.id,
            purpose,
          },
          actor,
        });
        return created;
      });
      return toLink(row, false);
    }
    // Only reachable when concurrent writers keep changing the order.
    throw new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'Could not create a payment link.');
  };

  return { getOrCreatePaymentLink, completeFromSession };
};

export default EcommerceStripePaymentService;
