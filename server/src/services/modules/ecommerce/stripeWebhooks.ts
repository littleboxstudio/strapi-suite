import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommercePaymentError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { str } from './providers/http';
import {
  verifyStripeSignature,
  type RetrievedCheckoutSession,
} from './providers/payments/stripeClient';
import type { ProviderRuntime } from './providers/registry';
import type { OrderHistoryEntry } from './orderHistory';

export type WebhookOutcome = 'PROCESSED' | 'IGNORED';
export type WebhookResult =
  | { duplicate: true }
  | { duplicate: false; status: WebhookOutcome | 'FAILED' };

/**
 * A permanent failure: redelivering the event can never succeed (the signed session does not
 * match the stored payment). Recorded as FAILED and answered 200 so Stripe stops retrying.
 */
const TERMINAL_ERROR = 'Error:STRIPE_SESSION_MISMATCH';
const isTerminalRow = (row: any): boolean =>
  row?.status === 'FAILED' &&
  typeof row.error === 'string' &&
  row.error.endsWith(':STRIPE_SESSION_MISMATCH');
const isTerminalError = (err: unknown): boolean =>
  err instanceof EcommercePaymentError && err.code === 'STRIPE_SESSION_MISMATCH';

const ACTOR = 'webhook:stripe';

type Collector = { emit(e: any): void; flush(): Promise<void> };

type StripeEvent = { id: string; type: string; data: { object: any } };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const idString = (v: any): string | null =>
  typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null;

/** Safe to store: never the error message (DB errors may quote row data). */
const errorLabel = (err: unknown): string => {
  if (err instanceof EcommercePaymentError) return `${err.name}:${err.code}`;
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
};

/** A unique violation raised by our own `webhook-event` insert, not by the processing. */
class DuplicateEvent extends Error {}

/**
 * Stripe webhooks (design 4.6 / 4.14). The `Stripe-Signature` is verified against the raw body
 * with the stored `webhookSecret` (300 s tolerance). Each `event.id` is processed once: the
 * `webhook-event` row (unique `eventId`) is written in the same transaction as the processing,
 * so a concurrent delivery of the same event blocks on the index and then sees a duplicate. A
 * failed processing rolls back and leaves a `FAILED` row; Stripe's retry reprocesses it.
 */
const EcommerceStripeWebhookService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const settings = (): {
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
  } => service('EcommerceSettingsService');
  const orders = (): {
    recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
    lockOrder(orderId: number): Promise<void>;
  } => service('EcommerceOrderService');
  const stripePayments = (): {
    completeFromSession(
      row: { id: number },
      retrieved: RetrievedCheckoutSession,
      actor: string,
      opts?: { collector?: { emit(e: any): void } }
    ): Promise<{ completed: boolean }>;
  } => service('EcommerceStripePaymentService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');

  const verify = async (rawBody: Buffer, signature: string): Promise<StripeEvent> => {
    const rt = await settings().getRuntime('stripe');
    const secret = rt ? str(rt, 'webhookSecret') : '';
    if (!secret || !Buffer.isBuffer(rawBody) || !verifyStripeSignature(rawBody, signature, secret)) {
      throw new EcommercePaymentError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
    }
    let event: any;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      event = null;
    }
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id ||
      typeof event.type !== 'string' ||
      !event.data ||
      typeof event.data.object !== 'object' ||
      event.data.object === null
    ) {
      throw new EcommercePaymentError('WEBHOOK_PAYLOAD_INVALID', 'Not a Stripe event.');
    }
    return event as StripeEvent;
  };

  /** The fields `completeFromSession` checks, read from the (signed) event's session object. */
  const sessionFromEvent = (obj: any): RetrievedCheckoutSession => ({
    id: String(obj.id),
    status: obj.status ?? 'complete',
    paymentStatus: obj.payment_status,
    paymentIntentId: idString(obj.payment_intent),
    amountTotal: obj.amount_total ?? null,
    metadata: obj.metadata ?? {},
  });

  const findSession = (sessionId: unknown) =>
    typeof sessionId === 'string' && sessionId
      ? strapi.db.query(uids().stripeSession).findOne({
          where: { sessionId },
          populate: { order: { select: ['id'] }, payment: true },
        })
      : Promise.resolve(null);

  const onSessionSettled = async (obj: any, collector: Collector): Promise<WebhookOutcome> => {
    const row = await findSession(obj.id);
    if (!row) return 'IGNORED'; // not a session created by this plugin
    await stripePayments().completeFromSession(row, sessionFromEvent(obj), ACTOR, { collector });
    return 'PROCESSED';
  };

  /** Closes the session and moves its still-PENDING payment to `paymentStatus`. */
  const closeSession = async (
    obj: any,
    from: string[],
    paymentStatus: 'FAILED' | 'CANCELLED'
  ): Promise<WebhookOutcome> => {
    const u = uids();
    const row = await findSession(obj.id);
    if (!row) return 'IGNORED';
    const orderId = idOf(row.order);
    if (orderId === null) return 'IGNORED';
    await orders().lockOrder(orderId);
    const { count } = await strapi.db.query(u.stripeSession).updateMany({
      where: { id: row.id, status: { $in: from } },
      data: { status: 'EXPIRED' },
    });
    if (!count) return 'IGNORED';
    const paymentId = idOf(row.payment);
    if (paymentId !== null) {
      const { count: moved } = await strapi.db.query(u.payment).updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: paymentStatus },
      });
      if (moved) {
        await history().record({
          orderId,
          type: paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_CANCELLED',
          description:
            paymentStatus === 'FAILED'
              ? 'Stripe payment failed'
              : 'Stripe payment cancelled (session expired)',
          previousValue: { paymentId, status: 'PENDING' },
          newValue: { paymentId, status: paymentStatus, sessionId: row.sessionId },
          actor: ACTOR,
        });
      }
    }
    return 'PROCESSED';
  };

  /** Applies one Stripe refund status to the refund stored with that `externalId`. */
  const applyRefund = async (
    stripeRefund: any,
    collector: Collector
  ): Promise<boolean> => {
    const u = uids();
    const externalId = idString(stripeRefund);
    const status = stripeRefund?.status;
    if (!externalId) return false;
    const target =
      status === 'succeeded'
        ? 'COMPLETED'
        : status === 'failed' || status === 'canceled'
          ? 'FAILED'
          : null;
    if (!target) return false;
    let row = await strapi.db.query(u.refund).findOne({
      where: { externalId },
      populate: { order: { select: ['id'] } },
    });
    if (!row) {
      // The event may beat the refund service storing the Stripe id: the refund carries our
      // `refundId` in its (signed) metadata.
      const refundId = Number(stripeRefund?.metadata?.refundId);
      if (Number.isSafeInteger(refundId) && refundId > 0) {
        const candidate = await strapi.db.query(u.refund).findOne({
          where: { id: refundId },
          populate: { order: { select: ['id'] } },
        });
        if (candidate && candidate.method === 'STRIPE' && !candidate.externalId) row = candidate;
      }
    }
    if (!row) return false; // REFUND rows are created by the refund service
    const orderId = idOf(row.order);
    if (orderId === null) return false;
    await orders().lockOrder(orderId);
    // A Stripe refund can fail after having succeeded (rare): COMPLETED -> FAILED is allowed.
    const from = target === 'COMPLETED' ? ['PENDING', 'PROCESSING'] : ['PENDING', 'PROCESSING', 'COMPLETED'];
    const current = await strapi.db.query(u.refund).findOne({ where: { id: row.id } });
    if (!current || !from.includes(current.status)) return false;
    const { count } = await strapi.db.query(u.refund).updateMany({
      where: { id: row.id, status: current.status },
      data:
        target === 'COMPLETED'
          ? { status: 'COMPLETED', completedAt: new Date().toISOString(), externalId }
          : { status: 'FAILED', externalId },
    });
    if (!count) return false;
    const operationId = randomUUID();
    await history().record({
      orderId,
      type: target === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
      description:
        target === 'COMPLETED'
          ? `Stripe refund of ${num(row.amount)} cents completed`
          : `Stripe refund of ${num(row.amount)} cents failed`,
      previousValue: { refundId: row.id, status: current.status },
      newValue: { refundId: row.id, status: target, externalId },
      actor: ACTOR,
      operationId,
    });
    if (target === 'COMPLETED' || current.status === 'COMPLETED') {
      await orders().recalculate(orderId, { actor: ACTOR, operationId });
    }
    collector.emit({
      type: target === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
      orderId,
      payload: {
        refundId: row.id,
        amount: num(row.amount),
        method: row.method ?? 'STRIPE',
        kind: row.kind ?? 'MONEY',
        externalId,
      },
    });
    return true;
  };

  const dispatch = async (event: StripeEvent, collector: Collector): Promise<WebhookOutcome> => {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return onSessionSettled(obj, collector);
      case 'checkout.session.async_payment_failed':
        return closeSession(obj, ['OPEN', 'COMPLETE'], 'FAILED');
      case 'checkout.session.expired':
        // A COMPLETE session (paid, or awaiting an asynchronous payment) is never cancelled here.
        return closeSession(obj, ['OPEN'], 'CANCELLED');
      case 'charge.refunded': {
        // Newer API versions omit `refunds`: refund.updated then carries each refund.
        const list = Array.isArray(obj?.refunds?.data) ? obj.refunds.data : [];
        let changed = false;
        for (const r of list) changed = (await applyRefund(r, collector)) || changed;
        return changed ? 'PROCESSED' : 'IGNORED';
      }
      case 'refund.updated':
      case 'refund.failed':
        return (await applyRefund(obj, collector)) ? 'PROCESSED' : 'IGNORED';
      default:
        return 'IGNORED';
    }
  };

  /** Records (or refreshes) a FAILED row after the processing transaction rolled back. */
  const recordFailure = async (event: StripeEvent, err: unknown): Promise<void> => {
    const q = strapi.db.query(uids().webhookEvent);
    const error = isTerminalError(err) ? TERMINAL_ERROR : errorLabel(err);
    try {
      const existing = await q.findOne({ where: { eventId: event.id } });
      if (existing) {
        if (existing.status === 'FAILED') {
          await q.update({ where: { id: existing.id }, data: { error } });
        }
        return;
      }
      await q.create({
        data: { provider: 'stripe', eventId: event.id, type: event.type, status: 'FAILED', error },
      });
    } catch (e) {
      // A concurrent delivery recorded it first: nothing to add. Any other failure must not
      // hide the original error (Stripe still gets a 500 and retries).
      if (!isUniqueViolation(e)) {
        strapi.log?.error(
          `[ecommerce] could not record failed Stripe webhook ${event.id}: ${errorLabel(e)}`
        );
      }
    }
  };

  const handle = async (rawBody: Buffer, signature: string): Promise<WebhookResult> => {
    const event = await verify(rawBody, signature);
    const u = uids();
    const existing = await strapi.db
      .query(u.webhookEvent)
      .findOne({ where: { eventId: event.id } });
    // PROCESSED / IGNORED, or a terminal failure: never processed again.
    if (existing && (existing.status !== 'FAILED' || isTerminalRow(existing))) {
      return { duplicate: true };
    }

    const collector = events().collector();
    let status: WebhookOutcome | 'DUPLICATE';
    try {
      status = await strapi.db.transaction(async () => {
        const q = strapi.db.query(u.webhookEvent);
        let rowId: number;
        if (existing) {
          // Retry of a FAILED event: only one concurrent retry claims it.
          const { count } = await q.updateMany({
            where: { id: existing.id, status: 'FAILED' },
            data: { status: 'PROCESSED', error: null },
          });
          if (!count) return 'DUPLICATE' as const;
          rowId = existing.id;
        } else {
          try {
            const row = await q.create({
              data: {
                provider: 'stripe',
                eventId: event.id,
                type: event.type,
                status: 'PROCESSED',
                error: null,
              },
            });
            rowId = row.id;
          } catch (err) {
            // Rethrown so the transaction rolls back (PostgreSQL aborts it anyway).
            if (isUniqueViolation(err)) throw new DuplicateEvent();
            throw err;
          }
        }
        const outcome = await dispatch(event, collector);
        if (outcome === 'IGNORED') {
          await q.update({ where: { id: rowId }, data: { status: 'IGNORED' } });
        }
        return outcome;
      });
    } catch (err) {
      if (err instanceof DuplicateEvent) return { duplicate: true };
      strapi.log?.error(
        `[ecommerce] Stripe webhook ${event.type} (${event.id}) failed: ${errorLabel(err)}`
      );
      await recordFailure(event, err);
      // Permanent: answered 200 so Stripe stops redelivering; it stays visible as FAILED.
      if (isTerminalError(err)) return { duplicate: false, status: 'FAILED' };
      throw err;
    }
    if (status === 'DUPLICATE') return { duplicate: true };
    await collector.flush();
    return { duplicate: false, status };
  };

  return { handle };
};

export default EcommerceStripeWebhookService;
