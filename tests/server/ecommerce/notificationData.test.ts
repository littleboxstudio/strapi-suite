import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_TEMPLATE_TYPES,
  buildTemplateData,
  formatMoney,
  notificationKey,
  templateForEvent,
  type NotificationTemplateType,
} from '../../../server/src/services/modules/ecommerce/notificationData';
import { getVariableCatalog } from '../../../server/src/services/modules/ecommerce/email/catalog';
import { renderTemplate } from '../../../server/src/services/modules/ecommerce/email/templateEngine';
import { DEFAULT_TEMPLATES } from '../../../server/src/services/modules/ecommerce/email/defaults';
import type { DomainEvent } from '../../../server/src/services/modules/ecommerce/events';

const spaces = (s: string) => s.replace(/[  ]/g, ' ');

const store: any = {
  storeName: 'Loja',
  logoUrl: null,
  brandColor: '#111111',
  storefrontUrl: 'https://shop.example',
  paymentSuccessPath: '/s',
  paymentCancelPath: '/c',
  timezone: 'Europe/Lisbon',
  shippingCountries: ['PT'],
  supportEmail: 'help@shop.example',
};

const makeOrder = (over: Record<string, any> = {}): any => ({
  id: 7,
  reference: 1042,
  publicId: 'pub-7',
  locale: 'en',
  orderStatus: 'OPEN',
  paymentStatus: 'PENDING',
  createdAt: '2026-11-11T10:00:00.000Z',
  cancelledAt: null,
  customer: { id: 3, firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
  totals: {
    itemsOriginal: 4000,
    productDiscount: 0,
    subtotal: 4000,
    orderDiscount: 0,
    shippingOriginal: 500,
    shippingDiscount: 0,
    shippingTotal: 500,
    total: 4500,
  },
  lines: [
    {
      id: 1,
      sku: 'SH-M',
      name: 'Shirt',
      option: 'M',
      unitPrice: 2000,
      unitDiscount: 0,
      quantity: 2,
      returnedQuantity: 0,
    },
  ],
  payments: [],
  summary: { orderTotal: 4500, total: 4500, paid: 0, pendingPayments: 0, refunded: 0, net: 0, due: 4500, excess: 0 },
  ...over,
});

const event = (type: DomainEvent['type'], payload: Record<string, unknown> = {}): DomainEvent => ({
  id: 'evt-1',
  type,
  orderId: 7,
  occurredAt: '2026-11-12T10:00:00.000Z',
  payload,
});

const EVENT_FOR: Record<NotificationTemplateType, DomainEvent> = {
  ORDER_CONFIRMATION: event('ORDER_CREATED'),
  PAYMENT_CONFIRMATION: event('PAYMENT_COMPLETED', { paymentId: 1, amount: 2990, method: 'STRIPE' }),
  PAYMENT_INSTRUCTIONS: event('PAYMENT_INSTRUCTIONS_SENT', {
    mode: 'STRIPE',
    url: 'https://checkout.stripe.com/c/pay/cs_1',
    expiresAt: '2026-11-12T09:55:00.000Z',
    amountDue: 4500,
    supplementary: false,
  }),
  SUPPLEMENTARY_PAYMENT: event('PAYMENT_INSTRUCTIONS_SENT', {
    mode: 'MANUAL',
    instructions: 'IBAN PT50 0000',
    amountDue: 500,
    supplementary: true,
  }),
  CANCELLATION: event('ORDER_CANCELLED', { reference: 1042, amountPaid: 4500 }),
  REFUND_STARTED: event('REFUND_STARTED', { refundId: 1, amount: 1000, method: 'STRIPE', kind: 'MONEY' }),
  REFUND_COMPLETED: event('REFUND_COMPLETED', {
    refundId: 1,
    amount: 1000,
    method: 'MANUAL_TRANSFER',
    kind: 'MONEY',
    reference: 'TRF-1',
    description: 'Shirt returned',
  }),
  STORE_CREDIT_ISSUED: event('STORE_CREDIT_ISSUED', {
    code: 'ABCD-EFGH-JKLM',
    amount: 1500,
    expiresAt: '2027-11-11T10:00:00.000Z',
    conditions: null,
  }),
};

const get = (data: any, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);

describe('templateForEvent', () => {
  it('maps every event of this plan to its template', () => {
    for (const [type, e] of Object.entries(EVENT_FOR)) expect(templateForEvent(e)).toBe(type);
  });

  it('sends nothing for store-credit refunds, failures and unrelated events', () => {
    expect(templateForEvent(event('REFUND_COMPLETED', { kind: 'STORE_CREDIT' }))).toBeNull();
    expect(templateForEvent(event('REFUND_FAILED', { kind: 'MONEY' }))).toBeNull();
    expect(templateForEvent(event('ORDER_MODIFIED'))).toBeNull();
    expect(templateForEvent(event('ORDER_ARCHIVED'))).toBeNull();
  });

  it('builds the unique key notif:<eventId>:<type>', () => {
    expect(notificationKey('evt-1', 'ORDER_CONFIRMATION')).toBe('notif:evt-1:ORDER_CONFIRMATION');
  });
});

describe('buildTemplateData', () => {
  it.each(NOTIFICATION_TEMPLATE_TYPES)('%s fills every catalog variable', (type) => {
    const data = buildTemplateData(type, { order: makeOrder(), store, event: EVENT_FOR[type] });
    for (const def of getVariableCatalog(type)) {
      const v = get(data, def.path);
      expect(v, def.path).not.toBeUndefined();
      if (def.kind === 'list') {
        expect(Array.isArray(v), def.path).toBe(true);
        for (const item of v) for (const f of def.itemFields!) expect(item[f], `${def.path}.${f}`).not.toBeUndefined();
      } else {
        expect(['string', 'number'].includes(typeof v), def.path).toBe(true);
      }
    }
  });

  it('formats money in the order locale: pt-PT 29,90 € and en €29.90', () => {
    expect(spaces(formatMoney(2990, 'pt-PT'))).toBe('29,90 €');
    expect(formatMoney(2990, 'en')).toBe('€29.90');
    const e = EVENT_FOR.PAYMENT_CONFIRMATION;
    const pt = buildTemplateData('PAYMENT_CONFIRMATION', { order: makeOrder({ locale: 'pt-PT' }), store, event: e });
    expect(spaces(pt.payment.amount)).toBe('29,90 €');
    const en = buildTemplateData('PAYMENT_CONFIRMATION', { order: makeOrder(), store, event: e });
    expect(en.payment.amount).toBe('€29.90');
  });

  it('passes zeros as empty strings in payment.amountDue and order.discount', () => {
    const order = makeOrder({ summary: { ...makeOrder().summary, due: 0, paid: 4500 } });
    const conf = buildTemplateData('ORDER_CONFIRMATION', { order, store, event: EVENT_FOR.ORDER_CONFIRMATION });
    expect(conf.order.discount).toBe('');
    expect(conf.payment.amountDue).toBe('');
    expect(conf.order.subtotal).toBe('€40.00');
    const paid = buildTemplateData('PAYMENT_CONFIRMATION', { order, store, event: EVENT_FOR.PAYMENT_CONFIRMATION });
    expect(paid.payment.amountDue).toBe('');

    const withDiscount = makeOrder({ totals: { ...makeOrder().totals, orderDiscount: 500 } });
    const d = buildTemplateData('ORDER_CONFIRMATION', { order: withDiscount, store, event: EVENT_FOR.ORDER_CONFIRMATION });
    expect(d.order.discount).toBe('€5.00');
    expect(d.payment.amountDue).toBe('€45.00');
  });

  it('takes payment.link and payment.expiresAt from the event', () => {
    const data = buildTemplateData('PAYMENT_INSTRUCTIONS', {
      order: makeOrder(),
      store,
      event: EVENT_FOR.PAYMENT_INSTRUCTIONS,
    });
    expect(data.payment.link).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(data.payment.expiresAt).toBe('Nov 12, 2026');
    expect(data.payment.amountDue).toBe('€45.00');
    const manual = buildTemplateData('SUPPLEMENTARY_PAYMENT', {
      order: makeOrder(),
      store,
      event: EVENT_FOR.SUPPLEMENTARY_PAYMENT,
    });
    expect(manual.payment.link).toBe('');
    expect(manual.payment.instructions).toBe('IBAN PT50 0000');
  });

  it('formats dates in the store time zone', () => {
    const order = makeOrder({ createdAt: '2026-11-11T23:30:00.000Z' });
    const e = EVENT_FOR.ORDER_CONFIRMATION;
    expect(buildTemplateData('ORDER_CONFIRMATION', { order, store, event: e }).order.date).toBe('Nov 11, 2026');
    const tokyo = { ...store, timezone: 'Asia/Tokyo' };
    expect(buildTemplateData('ORDER_CONFIRMATION', { order, store: tokyo, event: e }).order.date).toBe('Nov 12, 2026');
    const broken = { ...store, timezone: 'Not/AZone' };
    expect(buildTemplateData('ORDER_CONFIRMATION', { order, store: broken, event: e }).order.date).toBe('Nov 11, 2026');
  });

  it('refund.isPartial is "yes" below the amount received and "" otherwise', () => {
    const paid = makeOrder({ summary: { ...makeOrder().summary, paid: 4500 } });
    const partial = buildTemplateData('REFUND_COMPLETED', { order: paid, store, event: EVENT_FOR.REFUND_COMPLETED });
    expect(partial.refund.isPartial).toBe('yes');
    expect(partial.refund.reference).toBe('TRF-1');
    expect(partial.refund.description).toBe('Shirt returned');
    const full = buildTemplateData('REFUND_COMPLETED', {
      order: paid,
      store,
      event: event('REFUND_COMPLETED', { amount: 4500, method: 'STRIPE', kind: 'MONEY' }),
    });
    expect(full.refund.isPartial).toBe('');
  });

  it('falls back to the loaded refund row for fields the event lacks', () => {
    const data = buildTemplateData('REFUND_COMPLETED', {
      order: makeOrder(),
      store,
      event: event('REFUND_COMPLETED', { amount: 1000, method: 'STRIPE', kind: 'MONEY' }),
      extra: { refund: { reference: null, description: 'Late delivery' } },
    });
    expect(data.refund.description).toBe('Late delivery');
    expect(data.refund.reference).toBe('');
  });

  it('labels in Portuguese for pt orders and uses the manual payment label', () => {
    const order = makeOrder({ locale: 'pt', payments: [{ id: 1, methodLabel: 'MB WAY' }] });
    const data = buildTemplateData('PAYMENT_CONFIRMATION', {
      order,
      store,
      event: event('PAYMENT_COMPLETED', { paymentId: 1, amount: 100, method: 'MANUAL' }),
    });
    expect(data.payment.method).toBe('MB WAY');
    expect(buildTemplateData('ORDER_CONFIRMATION', { order, store, event: EVENT_FOR.ORDER_CONFIRMATION }).order.paymentStatus).toBe('Pendente');
  });

  it('a credit issued without an order uses the given customer', () => {
    const data = buildTemplateData('STORE_CREDIT_ISSUED', {
      order: null,
      store,
      event: { ...EVENT_FOR.STORE_CREDIT_ISSUED, orderId: undefined },
      extra: { customer: { firstName: 'Rui', lastName: 'Lopes', email: 'rui@example.pt' }, locale: 'en' },
    });
    expect(data.customer.firstName).toBe('Rui');
    expect(data.order.reference).toBe('');
    expect(data.credit.code).toBe('ABCD-EFGH-JKLM');
    expect(data.credit.amount).toBe('€15.00');
  });

  it('REFUND_STARTED does not say the order "has been refunded"', () => {
    const data = buildTemplateData('REFUND_STARTED', { order: makeOrder(), store, event: EVENT_FOR.REFUND_STARTED });
    const t = DEFAULT_TEMPLATES.REFUND_STARTED;
    const out = renderTemplate(t.subject, data, { escape: false }) + renderTemplate(t.html, data, { escape: true });
    expect(out).not.toMatch(/has been refunded/i);
    expect(out).toContain('€10.00');
  });

  it('CANCELLATION hides a zero amount paid', () => {
    const data = buildTemplateData('CANCELLATION', {
      order: makeOrder({ cancelledAt: '2026-11-12T10:00:00.000Z' }),
      store,
      event: event('ORDER_CANCELLED', { amountPaid: 0 }),
    });
    expect(data.order.amountPaid).toBe('');
    expect(data.order.cancelledAt).toBe('Nov 12, 2026');
  });
});
