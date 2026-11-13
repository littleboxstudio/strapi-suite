/**
 * Template data for customer notifications. Pure: no Strapi imports, no I/O.
 * Money arrives in integer cents and leaves formatted in the order's locale; dates leave
 * formatted in the store's time zone.
 */
import type { EmailTemplateType } from './email/catalog';
import type { DomainEvent, DomainEventType } from './events';
import type { OrderView } from './orders';
import type { StoreSettings } from './settings';
import { storeLogoVariables } from './domain/storeLogo';

export type NotificationTemplateType = Extract<
  EmailTemplateType,
  | 'ORDER_CONFIRMATION'
  | 'PAYMENT_CONFIRMATION'
  | 'PAYMENT_INSTRUCTIONS'
  | 'SUPPLEMENTARY_PAYMENT'
  | 'CANCELLATION'
  | 'REFUND_STARTED'
  | 'REFUND_COMPLETED'
  | 'STORE_CREDIT_ISSUED'
  | 'PARTIAL_SHIPMENT'
  | 'FULL_SHIPMENT'
  | 'DELIVERY_CONFIRMATION'
  | 'INVOICE_AVAILABLE'
  | 'CREDIT_NOTE_ISSUED'
>;

export const NOTIFICATION_TEMPLATE_TYPES: NotificationTemplateType[] = [
  'ORDER_CONFIRMATION',
  'PAYMENT_CONFIRMATION',
  'PAYMENT_INSTRUCTIONS',
  'SUPPLEMENTARY_PAYMENT',
  'CANCELLATION',
  'REFUND_STARTED',
  'REFUND_COMPLETED',
  'STORE_CREDIT_ISSUED',
  'PARTIAL_SHIPMENT',
  'FULL_SHIPMENT',
  'DELIVERY_CONFIRMATION',
  'INVOICE_AVAILABLE',
  'CREDIT_NOTE_ISSUED',
];

/** The template an event sends, or null when it sends none. */
export function templateForEvent(event: Pick<DomainEvent, 'type' | 'payload'>): NotificationTemplateType | null {
  const p = event.payload ?? {};
  const map: Partial<Record<DomainEventType, () => NotificationTemplateType | null>> = {
    ORDER_CREATED: () => 'ORDER_CONFIRMATION',
    PAYMENT_COMPLETED: () => 'PAYMENT_CONFIRMATION',
    PAYMENT_INSTRUCTIONS_SENT: () =>
      p.supplementary === true ? 'SUPPLEMENTARY_PAYMENT' : 'PAYMENT_INSTRUCTIONS',
    ORDER_CANCELLED: () => 'CANCELLATION',
    REFUND_STARTED: () => 'REFUND_STARTED',
    // Store-credit refunds are announced by STORE_CREDIT_ISSUED (or not at all).
    REFUND_COMPLETED: () => (p.kind === 'MONEY' ? 'REFUND_COMPLETED' : null),
    STORE_CREDIT_ISSUED: () => 'STORE_CREDIT_ISSUED',
    SHIPMENT_CREATED: () =>
      p.notify === false ? null : p.full === true ? 'FULL_SHIPMENT' : 'PARTIAL_SHIPMENT',
    SHIPMENT_DELIVERED: () =>
      p.allDelivered === true && p.notify !== false ? 'DELIVERY_CONFIRMATION' : null,
    INVOICE_ISSUED: () =>
      p.kind === 'INVOICE' ? 'INVOICE_AVAILABLE' : p.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE_ISSUED' : null,
  };
  return map[event.type]?.() ?? null;
}

export const notificationKey = (eventId: string, type: string): string => `notif:${eventId}:${type}`;

/** Extra rows the service loads for an event (all optional). */
export type NotificationExtra = {
  /** The refund row (REFUND_* events). */
  refund?: {
    amount?: number | null;
    method?: string | null;
    reference?: string | null;
    description?: string | null;
    externalId?: string | null;
    status?: string | null;
  } | null;
  /** The store credit row (STORE_CREDIT_ISSUED). */
  storeCredit?: {
    code?: string | null;
    initialAmount?: number | null;
    expiresAt?: string | null;
    conditions?: string | null;
  } | null;
  /** Customer used when there is no order (a credit issued outside an order). */
  customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  /** Locale used when there is no order. */
  locale?: string;
  /** The store's default locale (display-name fallback for promotions); absent → the order locale. */
  defaultLocale?: string;
  /** The shipment row (SHIPMENT_CREATED). */
  shipment?: ShipmentRow | null;
  /** The ACTIVE shipments of the order (for `shipment.allTracking`). */
  shipments?: ShipmentRow[];
  /** The invoice (INVOICE_ISSUED). */
  invoice?: { id: number; number?: string | null } | null;
  /** The credit note and the invoice it corrects (INVOICE_ISSUED of a credit note). */
  creditNote?: { id: number; number?: string | null; total?: number | null; invoiceNumber?: string | null } | null;
};

export type ShipmentRow = {
  id?: number;
  carrierName?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  items?: { lines?: unknown } | null;
};

type ItemRow = { name: string; option: string; sku: string; quantity: number };

const shipmentItems = (row: ShipmentRow | null | undefined): ItemRow[] => {
  const lines = row?.items?.lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((i) => i && typeof i === 'object')
    .map((i: any) => ({
      name: str(i.name),
      option: str(i.option),
      sku: str(i.sku),
      quantity: num(i.quantity),
    }));
};

export type NotificationDataContext = {
  order: OrderView | null;
  store: StoreSettings;
  event: DomainEvent;
  extra?: NotificationExtra;
  /** Strapi's own public URL, never shown in e-mails. */
  backofficeUrl?: string | null;
};

const LABELS: Record<'en' | 'pt', Record<string, string>> = {
  en: {
    'payment.PENDING': 'Pending',
    'payment.PARTIALLY_PAID': 'Partially paid',
    'payment.PAID': 'Paid',
    'payment.PARTIALLY_REFUNDED': 'Partially refunded',
    'payment.REFUNDED': 'Refunded',
    'promotion.fallback': 'Promotion',
    'method.STRIPE': 'Online payment',
    'method.MANUAL': 'Manual payment',
    'method.STORE_CREDIT': 'Store credit',
    'refund.STRIPE': 'Card / original payment method',
    'refund.MANUAL_TRANSFER': 'Bank transfer',
    'refund.STORE_CREDIT': 'Store credit',
  },
  pt: {
    'payment.PENDING': 'Pendente',
    'payment.PARTIALLY_PAID': 'Parcialmente pago',
    'payment.PAID': 'Pago',
    'payment.PARTIALLY_REFUNDED': 'Parcialmente reembolsado',
    'payment.REFUNDED': 'Reembolsado',
    'promotion.fallback': 'Promoção',
    'method.STRIPE': 'Pagamento online',
    'method.MANUAL': 'Pagamento manual',
    'method.STORE_CREDIT': 'Vale de crédito',
    'refund.STRIPE': 'Cartão / método de pagamento original',
    'refund.MANUAL_TRANSFER': 'Transferência bancária',
    'refund.STORE_CREDIT': 'Vale de crédito',
  },
};

const label = (locale: string, key: string): string => {
  const lang = locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  return LABELS[lang][key] ?? '';
};

/** A locale Intl accepts (falls back to `en`). */
const safeLocale = (locale: string | undefined | null): string => {
  try {
    return Intl.getCanonicalLocales(locale || 'en')[0] ?? 'en';
  } catch {
    return 'en';
  }
};

const safeTimeZone = (tz: string | undefined | null): string => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz || 'UTC' });
    return tz || 'UTC';
  } catch {
    return 'UTC';
  }
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const formatMoney = (cents: number, locale: string): string =>
  new Intl.NumberFormat(safeLocale(locale), { style: 'currency', currency: 'EUR' }).format(
    num(cents) / 100
  );

/** Zero (or nothing) → '' so a template's `{{#if}}` hides it. */
const moneyOrEmpty = (cents: unknown, locale: string): string =>
  num(cents) === 0 ? '' : formatMoney(num(cents), locale);

export const formatDate = (
  value: unknown,
  locale: string,
  timeZone: string,
  opts: { withTime?: boolean } = {}
): string => {
  if (typeof value !== 'string' && !(value instanceof Date)) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(safeLocale(locale), {
    dateStyle: 'medium',
    ...(opts.withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: safeTimeZone(timeZone),
  }).format(d);
};

const IN_FLIGHT_REFUND = ['PENDING', 'PROCESSING'];

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Exactly the catalog variables of `type` (plan 2), filled from the order, the store and the
 * event. Zeros pass as '' in `payment.amountDue`, `order.discount` and `order.amountPaid`.
 */
export function buildTemplateData(
  type: NotificationTemplateType,
  ctx: NotificationDataContext
): Record<string, any> {
  const { order, store, event } = ctx;
  const extra = ctx.extra ?? {};
  const p = event.payload ?? {};
  const locale = order?.locale || extra.locale || 'en';
  const tz = store.timezone;
  const money = (c: unknown) => formatMoney(num(c), locale);
  const date = (v: unknown) => formatDate(v, locale, tz);
  /** Payment deadlines show the time too (a Stripe link lasts under 24 h). */
  const deadline = (v: unknown) => formatDate(v, locale, tz, { withTime: true });
  const snapshot: Record<string, unknown> = order?.customer ?? extra.customer ?? {};

  const data: Record<string, any> = {
    store: {
      name: str(store.storeName),
      ...storeLogoVariables(store, ctx.backofficeUrl),
      brandColor: str(store.brandColor),
      url: str(store.storefrontUrl),
      supportEmail: str(store.supportEmail),
    },
    customer: {
      firstName: str(snapshot.firstName),
      lastName: str(snapshot.lastName),
      email: str(snapshot.email),
    },
    order: {
      reference: str(order?.reference),
      date: date(order?.createdAt),
    },
  };

  const methodLabel = (method: unknown, paymentId?: unknown): string => {
    if (paymentId !== undefined && order) {
      const payment = order.payments.find((x) => x.id === paymentId);
      if (typeof payment?.methodLabel === 'string' && payment.methodLabel) return payment.methodLabel;
    }
    return label(locale, `method.${str(method)}`);
  };

  switch (type) {
    case 'ORDER_CONFIRMATION': {
      const lines = order?.lines ?? [];
      Object.assign(data.order, {
        items: lines
          .map((l) => ({ l, qty: num(l.quantity) - num(l.returnedQuantity) }))
          .filter(({ qty }) => qty > 0)
          .map(({ l, qty }) => {
            const unit = num(l.unitPrice) - num(l.unitDiscount);
            return {
              name: str(l.name),
              option: str(l.option),
              sku: str(l.sku),
              quantity: qty,
              unitPrice: money(unit),
              total: money(unit * qty),
            };
          }),
        subtotal: money(order?.totals.subtotal),
        shipping: money(order?.totals.shippingTotal),
        discount: moneyOrEmpty(order?.totals.orderDiscount, locale),
        promotions: (order?.promotions ?? []).map((a) => ({
          // Never the internal name: a neutral label when no customer-visible name exists.
          name:
            a.displayName?.[locale] ||
            (extra.defaultLocale ? a.displayName?.[extra.defaultLocale] : '') ||
            label(locale, 'promotion.fallback'),
          amount: money(a.amount),
        })),
        total: money(order?.totals.total),
        paymentStatus: order ? label(locale, `payment.${order.paymentStatus}`) : '',
      });
      data.payment = {
        link: str(p.url),
        amountDue: moneyOrEmpty(order?.summary.due, locale),
        expiresAt: deadline(p.expiresAt),
      };
      break;
    }
    case 'PAYMENT_CONFIRMATION':
      data.payment = {
        amount: money(p.amount),
        method: methodLabel(p.method, p.paymentId),
        amountDue: moneyOrEmpty(order?.summary.due, locale),
      };
      break;
    case 'PAYMENT_INSTRUCTIONS':
    case 'SUPPLEMENTARY_PAYMENT':
      data.payment = {
        amountDue: moneyOrEmpty(p.amountDue, locale),
        method:
          p.mode === 'STRIPE'
            ? label(locale, 'method.STRIPE')
            : str(p.methodLabel) || label(locale, 'method.MANUAL'),
        instructions: str(p.instructions),
        link: str(p.url),
        expiresAt: deadline(p.expiresAt),
      };
      break;
    case 'CANCELLATION':
      Object.assign(data.order, {
        cancelledAt: date(order?.cancelledAt ?? event.occurredAt),
        amountPaid: moneyOrEmpty(p.amountPaid, locale),
      });
      break;
    case 'REFUND_STARTED':
    case 'REFUND_COMPLETED': {
      const r = extra.refund ?? {};
      const amount = num(p.amount ?? r.amount);
      const method = str(p.method ?? r.method);
      // The order summary counts COMPLETED refunds only: an in-flight one is subtracted here.
      const inFlight = r.status ? IN_FLIGHT_REFUND.includes(r.status) : type === 'REFUND_STARTED';
      const heldAfter = num(order?.summary.net) - (inFlight ? amount : 0);
      const reference =
        str(p.reference ?? r.reference) ||
        (method === 'STRIPE' ? str(p.externalId ?? r.externalId) : '');
      data.refund = {
        amount: money(amount),
        method: label(locale, `refund.${method}`),
        reference,
        // Partial: the customer's money is still (partly) held after this refund.
        isPartial: heldAfter > 0 ? 'yes' : '',
        description: str(p.description ?? r.description),
      };
      break;
    }
    case 'PARTIAL_SHIPMENT':
    case 'FULL_SHIPMENT': {
      const s = extra.shipment ?? {};
      const lines = order?.lines ?? [];
      const pending = Array.isArray(p.pending) ? (p.pending as any[]) : [];
      data.shipment = {
        items: shipmentItems(extra.shipment),
        carrier: str(s.carrierName),
        trackingCode: str(s.trackingCode),
        trackingUrl: str(s.trackingUrl),
      };
      if (type === 'PARTIAL_SHIPMENT') {
        data.shipment.pendingItems = pending
          .map((x) => ({ line: lines.find((l) => l.id === num(x?.orderLineId)), quantity: num(x?.quantity) }))
          .filter(({ line, quantity }) => !!line && quantity > 0)
          .map(({ line, quantity }) => ({
            name: str(line!.name),
            option: str(line!.option),
            sku: str(line!.sku),
            quantity,
          }));
      } else {
        const all = extra.shipments ?? [];
        data.shipment.allTracking =
          all.length > 1
            ? all.map((x) => ({
                carrier: str(x.carrierName),
                trackingCode: str(x.trackingCode),
                trackingUrl: str(x.trackingUrl),
              }))
            : [];
      }
      break;
    }
    case 'DELIVERY_CONFIRMATION':
      data.delivery = { date: date(p.deliveredAt) };
      break;
    case 'INVOICE_AVAILABLE':
      data.invoice = { number: str(extra.invoice?.number) };
      data.attachment = { kind: 'INVOICE_PDF', invoiceId: num(extra.invoice?.id ?? p.invoiceId) };
      break;
    case 'CREDIT_NOTE_ISSUED':
      data.creditNote = {
        number: str(extra.creditNote?.number),
        amount: money(extra.creditNote?.total),
        invoiceNumber: str(extra.creditNote?.invoiceNumber),
      };
      data.attachment = { kind: 'INVOICE_PDF', invoiceId: num(extra.creditNote?.id ?? p.invoiceId) };
      break;
    case 'STORE_CREDIT_ISSUED': {
      const c = extra.storeCredit ?? {};
      data.credit = {
        amount: money(p.amount ?? c.initialAmount),
        code: str(p.code ?? c.code),
        expiresAt: date(p.expiresAt ?? c.expiresAt),
        conditions: str(p.conditions ?? c.conditions),
      };
      break;
    }
  }
  return data;
}
