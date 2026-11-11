import type { Core } from '@strapi/strapi';
import { ECOMMERCE_MODULE, PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceEmailError, EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { sendWithResend } from './providers/email/resendSender';
import {
  buildTemplateData,
  notificationKey,
  templateForEvent,
  type NotificationExtra,
  type NotificationTemplateType,
} from './notificationData';
import type { DomainEvent, DomainEventHandler } from './events';
import type { OrderView } from './orders';
import type { StoreSettings } from './settings';
import type { ProviderRuntime } from './providers/registry';
import type { OrderHistoryEntry } from './orderHistory';

export type NotificationStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export type NotificationView = {
  id: number;
  orderId: number | null;
  type: string;
  eventId: string | null;
  recipient: string | null;
  locale: string | null;
  status: NotificationStatus | null;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string | null;
};

const SYSTEM = 'system';
/** A row claimed by a sender that has not finished (a crash leaves it resendable). */
const IN_PROGRESS = 'IN_PROGRESS';

const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : typeof v === 'object' ? (v.id ?? null) : Number(v);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toView = (r: any): NotificationView => ({
  id: r.id,
  orderId: idOf(r.order),
  type: r.type,
  eventId: r.eventId ?? null,
  recipient: r.recipient ?? null,
  locale: r.locale ?? null,
  status: r.status ?? null,
  providerMessageId: r.providerMessageId ?? null,
  error: r.error ?? null,
  attempts: num(r.attempts),
  sentAt: r.sentAt ?? null,
  createdAt: r.createdAt ?? null,
});

/**
 * Error text safe to store and show: our own error codes and messages (never secrets nor
 * provider bodies), otherwise only the error class (a raw message may carry personal data).
 */
const describeError = (err: unknown): string => {
  if (err instanceof EcommerceEmailError) {
    return err.message && err.message !== err.code ? `${err.code}: ${err.message}` : err.code;
  }
  if (err instanceof EcommerceValidationError) return 'TEMPLATE_INVALID';
  return err instanceof Error ? err.name : typeof err;
};

const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

type Prepared = {
  type: NotificationTemplateType;
  orderId: number | null;
  recipient: string;
  locale: string;
  payload: Record<string, unknown>;
};

/**
 * Customer e-mails driven by domain events (after commit). Each (event, template) pair has one
 * row keyed `notif:<eventId>:<type>`; a failure is recorded, never thrown, and never undoes the
 * business operation. FAILED / SKIPPED rows can be resent from the admin with the same payload.
 */
const EcommerceNotificationService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const rows = () => strapi.db.query(uids().notification);
  const history = (): { record(e: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const settings = (): {
    getStoreSettings(): Promise<StoreSettings>;
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
  } => service('EcommerceSettingsService');
  const templates = (): {
    render(type: string, locale: string, data: Record<string, unknown>): Promise<{ subject: string; html: string }>;
  } => service('EcommerceEmailTemplateService');

  const logError = (what: string, err: unknown) => {
    const name = err instanceof Error ? err.name : typeof err;
    strapi.log?.error?.(`[ecommerce] notification ${what} failed: ${name}`);
  };

  const defaultLocale = async (): Promise<string> => {
    try {
      return (await strapi.plugin('i18n').service('locales').getDefaultLocale()) || 'en';
    } catch {
      return 'en';
    }
  };

  const recordHistory = async (row: any, status: 'SENT' | 'FAILED', actor: string): Promise<void> => {
    const orderId = idOf(row.order);
    if (orderId === null) return;
    try {
      await history().record({
        orderId,
        type: status === 'SENT' ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
        description:
          status === 'SENT' ? `E-mail ${row.type} sent` : `E-mail ${row.type} could not be sent`,
        previousValue: null,
        newValue: {
          notificationId: row.id,
          type: row.type,
          attempts: num(row.attempts),
          ...(status === 'FAILED' ? { error: row.error ?? null } : {}),
        },
        actor,
      });
    } catch (err) {
      logError('history', err);
    }
  };

  /** Loads what the template needs: the order, the store and the refund / credit rows. */
  const prepare = async (event: DomainEvent, type: NotificationTemplateType): Promise<Prepared> => {
    const u = uids();
    const p = event.payload ?? {};
    const orderId = event.orderId ?? null;
    const order: OrderView | null =
      orderId === null ? null : await service('EcommerceOrderService').get(orderId);
    const extra: NotificationExtra = {};
    if (type === 'REFUND_STARTED' || type === 'REFUND_COMPLETED') {
      const refundId = idOf(p.refundId);
      if (refundId !== null) extra.refund = await strapi.db.query(u.refund).findOne({ where: { id: refundId } });
    }
    let creditEmail: string | null = null;
    if (type === 'STORE_CREDIT_ISSUED') {
      const creditId = idOf(p.storeCreditId);
      const credit =
        creditId === null
          ? null
          : await strapi.db.query(u.storeCredit).findOne({ where: { id: creditId }, populate: { customer: true } });
      extra.storeCredit = credit;
      creditEmail = credit?.emailNormalized ?? null;
      if (!order) {
        const c = credit?.customer ?? null;
        extra.customer = {
          firstName: c?.firstName ?? '',
          lastName: c?.lastName ?? '',
          email: c?.email ?? creditEmail ?? '',
        };
        extra.locale = await defaultLocale();
      }
    }
    const store = await settings().getStoreSettings();
    const payload = buildTemplateData(type, { order, store, event, extra });
    const recipient = order ? order.customer?.email : (extra.customer?.email ?? creditEmail);
    return {
      type,
      orderId,
      recipient: typeof recipient === 'string' ? recipient.trim() : '',
      locale: order?.locale || extra.locale || (await defaultLocale()),
      payload,
    };
  };

  /**
   * One delivery attempt for `row` (status FAILED / SKIPPED or freshly claimed). SKIPPED when
   * there is no recipient or Resend is not active; otherwise claims the attempt (conditional
   * `attempts++`, so two concurrent senders cannot both send) then renders and sends.
   */
  const deliver = async (row: any, actor: string): Promise<any> => {
    const q = rows();
    const skip = async (error: string) =>
      q.update({ where: { id: row.id }, data: { status: 'SKIPPED', error } });

    if (!isEmail(row.recipient)) return skip('NO_RECIPIENT');
    const rt = await settings().getRuntime('resend');
    if (!rt || !rt.active) return skip('EMAIL_NOT_CONFIGURED');

    const attempts = num(row.attempts);
    const { count } = await q.updateMany({
      where: { id: row.id, attempts, status: { $ne: 'SENT' } },
      data: { attempts: attempts + 1, status: 'FAILED', error: IN_PROGRESS },
    });
    if (!count) return q.findOne({ where: { id: row.id } });

    let updated: any;
    try {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const message = await templates().render(row.type, row.locale, payload);
      const { id } = await sendWithResend(rt, {
        to: row.recipient,
        subject: message.subject,
        html: message.html,
        idempotencyKey: row.uniqueKey,
      });
      updated = await q.update({
        where: { id: row.id },
        data: { status: 'SENT', providerMessageId: id, sentAt: new Date().toISOString(), error: null },
      });
      await recordHistory(updated, 'SENT', actor);
    } catch (err) {
      updated = await q.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: describeError(err) },
      });
      await recordHistory(updated, 'FAILED', actor);
    }
    return updated;
  };

  /** Inserts the row for `uniqueKey`; on a concurrent insert, returns the existing one. */
  const claimRow = async (event: DomainEvent, uniqueKey: string, prepared: Prepared): Promise<any> => {
    try {
      return await rows().create({
        data: {
          order: prepared.orderId,
          type: prepared.type,
          eventId: event.id,
          uniqueKey,
          recipient: prepared.recipient || null,
          locale: prepared.locale,
          status: 'FAILED',
          providerMessageId: null,
          error: IN_PROGRESS,
          attempts: 0,
          sentAt: null,
          payload: prepared.payload,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return null;
    }
  };

  const handle = async (event: DomainEvent): Promise<void> => {
    try {
      const type = templateForEvent(event);
      if (!type) return;
      const uniqueKey = notificationKey(event.id, type);
      const existing = await rows().findOne({ where: { uniqueKey } });
      if (existing) {
        // A redelivered event: sent once only; an earlier failure is retried.
        if (existing.status !== 'SENT' && existing.error !== IN_PROGRESS) await deliver(existing, SYSTEM);
        return;
      }
      const prepared = await prepare(event, type);
      const row = await claimRow(event, uniqueKey, prepared);
      if (!row) return; // another handler owns this key
      await deliver(row, SYSTEM);
    } catch (err) {
      logError(`for ${event?.type} (event ${event?.id})`, err);
    }
  };

  const resend = async (notificationId: number | string, actor: string): Promise<NotificationView> => {
    const id = Number(notificationId);
    const row = Number.isInteger(id) ? await rows().findOne({ where: { id } }) : null;
    if (!row) throw new EcommerceNotFoundError('Notification not found');
    if (row.status === 'SENT') return toView(row);
    let target = row;
    if (!isEmail(row.recipient)) {
      // The snapshot may have been corrected since: take the order's current e-mail.
      const orderId = idOf(row.order);
      if (orderId !== null) {
        const order: OrderView = await service('EcommerceOrderService').get(orderId);
        const email = typeof order.customer?.email === 'string' ? order.customer.email.trim() : '';
        if (email) target = await rows().update({ where: { id: row.id }, data: { recipient: email } });
      }
    }
    const updated = await deliver(target, actor);
    return toView(updated ?? target);
  };

  const listForOrder = async (orderId: number | string): Promise<NotificationView[]> => {
    const list = await rows().findMany({
      where: { order: { id: Number(orderId) } },
      orderBy: [{ id: 'desc' }],
    });
    return list.map(toView);
  };

  return { handle, resend, listForOrder };
};

/**
 * Subscribes the notification service to every domain event (from `bootstrap`). Events are
 * handled only while the e-commerce module is active.
 */
export function subscribeNotifications(strapi: Core.Strapi): void {
  const isActive = async (): Promise<boolean> => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const setting = await strapi.db
      .query(config.uuid.app.setting)
      .findOne({ where: { module: ECOMMERCE_MODULE, property: 'active' } });
    return setting?.value === 'true';
  };
  const handler: DomainEventHandler = async (event) => {
    try {
      if (!(await isActive())) return;
      await strapi.plugin(PLUGIN_ID).service('EcommerceNotificationService').handle(event);
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      strapi.log?.error?.(`[ecommerce] notification subscriber failed: ${name}`);
    }
  };
  strapi.plugin(PLUGIN_ID).service('EcommerceEventBus').subscribe('*', handler);
}

export default EcommerceNotificationService;
