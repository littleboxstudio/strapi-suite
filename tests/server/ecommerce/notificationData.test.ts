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
  PARTIAL_SHIPMENT: event('SHIPMENT_CREATED', {
    shipmentId: 5,
    full: false,
    notify: true,
    pending: [{ orderLineId: 1, quantity: 1 }],
  }),
  FULL_SHIPMENT: event('SHIPMENT_CREATED', { shipmentId: 5, full: true, notify: true, pending: [] }),
  DELIVERY_CONFIRMATION: event('SHIPMENT_DELIVERED', {
    shipmentId: 5,
    deliveredAt: '2026-11-12T23:30:00.000Z',
    allDelivered: true,
    notify: true,
  }),
  INVOICE_AVAILABLE: event('INVOICE_ISSUED', { invoiceId: 9, kind: 'INVOICE' }),
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

  it('shipment, delivery and invoice events', () => {
    const t = (type: any, payload: any) => templateForEvent(event(type, payload));
    expect(t('SHIPMENT_CREATED', { full: false })).toBe('PARTIAL_SHIPMENT');
    expect(t('SHIPMENT_CREATED', { full: true, notify: true })).toBe('FULL_SHIPMENT');
    expect(t('SHIPMENT_CREATED', { full: true, notify: false })).toBeNull();
    expect(t('SHIPMENT_DELIVERED', { allDelivered: true })).toBe('DELIVERY_CONFIRMATION');
    expect(t('SHIPMENT_DELIVERED', { allDelivered: true, notify: false })).toBeNull();
    expect(t('SHIPMENT_DELIVERED', { allDelivered: false, notify: true })).toBeNull();
    expect(t('INVOICE_ISSUED', { kind: 'INVOICE' })).toBe('INVOICE_AVAILABLE');
    expect(t('INVOICE_ISSUED', { kind: 'CREDIT_NOTE' })).toBeNull();
    expect(t('RETURN_REGISTERED', {})).toBeNull();
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
    // Date AND time, in the store time zone (Lisbon = UTC in November).
    expect(spaces(data.payment.expiresAt)).toBe('Nov 12, 2026, 9:55 AM');
    const tokyo = buildTemplateData('PAYMENT_INSTRUCTIONS', {
      order: makeOrder(),
      store: { ...store, timezone: 'Asia/Tokyo' },
      event: EVENT_FOR.PAYMENT_INSTRUCTIONS,
    });
    expect(spaces(tokyo.payment.expiresAt)).toBe('Nov 12, 2026, 6:55 PM');
    expect(data.payment.amountDue).toBe('€45.00');
    const manual = buildTemplateData('SUPPLEMENTARY_PAYMENT', {
      order: makeOrder(),
      store,
      event: EVENT_FOR.SUPPLEMENTARY_PAYMENT,
    });
    expect(manual.payment.link).toBe('');
    expect(manual.payment.instructions).toBe('IBAN PT50 0000');
    expect(manual.payment.method).toBe('Manual payment');
    expect(manual.payment.expiresAt).toBe('');
    const named = buildTemplateData('PAYMENT_INSTRUCTIONS', {
      order: makeOrder(),
      store,
      event: event('PAYMENT_INSTRUCTIONS_SENT', { mode: 'MANUAL', instructions: 'x', methodLabel: 'MB WAY', amountDue: 100 }),
    });
    expect(named.payment.method).toBe('MB WAY');
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

  it('refund.isPartial is "yes" only while money is still held after this refund', () => {
    const sum = makeOrder().summary;
    // COMPLETED: the summary already includes the refund.
    const held = makeOrder({ summary: { ...sum, paid: 4500, refunded: 1000, net: 3500 } });
    const partial = buildTemplateData('REFUND_COMPLETED', { order: held, store, event: EVENT_FOR.REFUND_COMPLETED });
    expect(partial.refund.isPartial).toBe('yes');
    expect(partial.refund.reference).toBe('TRF-1');
    expect(partial.refund.description).toBe('Shirt returned');
    // The closing refund of two sequential ones, or the credit-restored + money case: nothing held.
    const closed = makeOrder({ summary: { ...sum, paid: 5000, refunded: 5000, net: 0 } });
    const full = buildTemplateData('REFUND_COMPLETED', {
      order: closed,
      store,
      event: event('REFUND_COMPLETED', { amount: 2500, method: 'STRIPE', kind: 'MONEY' }),
    });
    expect(full.refund.isPartial).toBe('');
    // STARTED (in flight): the summary does not include it yet.
    const before = makeOrder({ summary: { ...sum, paid: 4500, refunded: 0, net: 4500 } });
    const startedAll = buildTemplateData('REFUND_STARTED', {
      order: before,
      store,
      event: event('REFUND_STARTED', { amount: 4500, method: 'STRIPE', kind: 'MONEY' }),
    });
    expect(startedAll.refund.isPartial).toBe('');
    const startedSome = buildTemplateData('REFUND_STARTED', {
      order: before,
      store,
      event: event('REFUND_STARTED', { amount: 1000, method: 'STRIPE', kind: 'MONEY' }),
    });
    expect(startedSome.refund.isPartial).toBe('yes');
    // A STARTED event handled after the refund completed: the row status says it is counted.
    const settled = makeOrder({ summary: { ...sum, paid: 4500, refunded: 4500, net: 0 } });
    const late = buildTemplateData('REFUND_STARTED', {
      order: settled,
      store,
      event: event('REFUND_STARTED', { amount: 4500, method: 'STRIPE', kind: 'MONEY' }),
      extra: { refund: { status: 'COMPLETED' } },
    });
    expect(late.refund.isPartial).toBe('');
  });

  it('Stripe refunds use the Stripe refund id as reference and a refund method label', () => {
    const e = event('REFUND_COMPLETED', { amount: 1000, method: 'STRIPE', kind: 'MONEY', reference: null, externalId: 're_123' });
    const en = buildTemplateData('REFUND_COMPLETED', { order: makeOrder(), store, event: e });
    expect(en.refund.reference).toBe('re_123');
    expect(en.refund.method).toBe('Card / original payment method');
    const pt = buildTemplateData('REFUND_COMPLETED', { order: makeOrder({ locale: 'pt-PT' }), store, event: e });
    expect(pt.refund.method).toBe('Cartão / método de pagamento original');
    const fromRow = buildTemplateData('REFUND_COMPLETED', {
      order: makeOrder(),
      store,
      event: event('REFUND_COMPLETED', { amount: 1000, method: 'STRIPE', kind: 'MONEY' }),
      extra: { refund: { externalId: 're_row' } },
    });
    expect(fromRow.refund.reference).toBe('re_row');
    expect(buildTemplateData('REFUND_COMPLETED', { order: makeOrder(), store, event: EVENT_FOR.REFUND_COMPLETED }).refund.method).toBe('Bank transfer');
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

describe('buildTemplateData: shipments, delivery and invoice', () => {
  const shipRow = (id: number, over: Record<string, any> = {}) => ({
    id,
    carrierName: 'CTT',
    trackingCode: `RR${id}`,
    trackingUrl: `https://ctt.pt/RR${id}`,
    items: { lines: [{ orderLineId: 1, sku: 'SH-M', name: 'Shirt', option: 'M', quantity: 1 }] },
    ...over,
  });
  const order = () =>
    makeOrder({
      lines: [
        { id: 1, sku: 'SH-M', name: 'Shirt', option: 'M', unitPrice: 2000, unitDiscount: 0, quantity: 2, returnedQuantity: 0 },
      ],
    });

  it('PARTIAL_SHIPMENT: items from the shipment, pendingItems from the event with order line data', () => {
    const d = buildTemplateData('PARTIAL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.PARTIAL_SHIPMENT,
      extra: { shipment: shipRow(5) },
    });
    expect(d.shipment.items).toEqual([{ name: 'Shirt', option: 'M', sku: 'SH-M', quantity: 1 }]);
    expect(d.shipment.pendingItems).toEqual([{ name: 'Shirt', option: 'M', sku: 'SH-M', quantity: 1 }]);
    expect(d.shipment).toMatchObject({ carrier: 'CTT', trackingCode: 'RR5', trackingUrl: 'https://ctt.pt/RR5' });
  });

  it('null carrier, tracking code and url become empty strings; option null becomes empty', () => {
    const d = buildTemplateData('FULL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.FULL_SHIPMENT,
      extra: {
        shipment: shipRow(5, {
          carrierName: null,
          trackingCode: null,
          trackingUrl: null,
          items: { lines: [{ orderLineId: 1, sku: 'A', name: 'A', option: null, quantity: 2 }] },
        }),
      },
    });
    expect(d.shipment).toMatchObject({ carrier: '', trackingCode: '', trackingUrl: '' });
    expect(d.shipment.items[0].option).toBe('');
  });

  it('FULL_SHIPMENT: allTracking lists every active shipment only when there is more than one', () => {
    const one = buildTemplateData('FULL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.FULL_SHIPMENT,
      extra: { shipment: shipRow(5), shipments: [shipRow(5)] },
    });
    expect(one.shipment.allTracking).toEqual([]);
    const two = buildTemplateData('FULL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.FULL_SHIPMENT,
      extra: { shipment: shipRow(5), shipments: [shipRow(4), shipRow(5)] },
    });
    expect(two.shipment.allTracking).toEqual([
      { carrier: 'CTT', trackingCode: 'RR4', trackingUrl: 'https://ctt.pt/RR4' },
      { carrier: 'CTT', trackingCode: 'RR5', trackingUrl: 'https://ctt.pt/RR5' },
    ]);
    const partial = buildTemplateData('PARTIAL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.PARTIAL_SHIPMENT,
      extra: { shipment: shipRow(5), shipments: [shipRow(4), shipRow(5)] },
    });
    expect(partial.shipment.allTracking).toBeUndefined();
  });

  it('DELIVERY_CONFIRMATION: delivery.date in the store time zone', () => {
    const d = buildTemplateData('DELIVERY_CONFIRMATION', {
      order: order(),
      store: { ...store, timezone: 'Asia/Tokyo' },
      event: EVENT_FOR.DELIVERY_CONFIRMATION,
    });
    expect(d.delivery.date).toBe('Nov 13, 2026');
  });

  it('INVOICE_AVAILABLE: invoice.number and the out-of-catalog PDF attachment marker', () => {
    const d = buildTemplateData('INVOICE_AVAILABLE', {
      order: order(),
      store,
      event: EVENT_FOR.INVOICE_AVAILABLE,
      extra: { invoice: { id: 9, number: 'FR 2026/1' } },
    });
    expect(d.invoice.number).toBe('FR 2026/1');
    expect(d.attachment).toEqual({ kind: 'INVOICE_PDF', invoiceId: 9 });
    const other = buildTemplateData('FULL_SHIPMENT', {
      order: order(),
      store,
      event: EVENT_FOR.FULL_SHIPMENT,
      extra: { shipment: shipRow(5) },
    });
    expect(other.attachment).toBeUndefined();
  });
});

describe('ORDER_CONFIRMATION promotions', () => {
  const applied = (over: Record<string, any> = {}) => ({
    promotionId: 1,
    name: 'Internal summer 20',
    displayName: { pt: 'Verão' },
    code: 'SECRET20',
    amount: 500,
    ...over,
  });
  const build = (order: any, extra?: any) =>
    buildTemplateData('ORDER_CONFIRMATION', { order, store, event: event('ORDER_CREATED'), extra });
  const html = (data: any) => renderTemplate(DEFAULT_TEMPLATES.ORDER_CONFIRMATION.html, data);

  it('uses the display name of the order locale and the money in that locale', () => {
    const data = build(makeOrder({ locale: 'pt', promotions: [applied()] }));
    expect(data.order.promotions).toEqual([{ name: 'Verão', amount: formatMoney(500, 'pt') }]);
  });

  it('falls back to the default locale, then to the name', () => {
    const order = makeOrder({ locale: 'en', promotions: [applied()] });
    expect(build(order, { defaultLocale: 'pt' }).order.promotions[0].name).toBe('Verão');
  });

  it('never shows the internal name: a neutral label in the order locale', () => {
    const en = makeOrder({ locale: 'en', promotions: [applied()] });
    expect(build(en).order.promotions[0].name).toBe('Promotion');
    expect(build(en, { defaultLocale: 'en' }).order.promotions[0].name).toBe('Promotion');
    const pt = makeOrder({ locale: 'pt', promotions: [applied({ displayName: {} })] });
    expect(build(pt).order.promotions[0].name).toBe('Promoção');
    expect(html(build(pt))).not.toContain('Internal summer 20');
  });

  it('renders a gift line at 0 and labels the block as already included', () => {
    const order = makeOrder({
      promotions: [applied()],
      lines: [
        ...makeOrder().lines,
        { id: 2, sku: 'G', name: 'Free tote', option: '', unitPrice: 900, unitDiscount: 900, quantity: 1, returnedQuantity: 0 },
      ],
    });
    const data = build(order);
    expect(data.order.items[1]).toMatchObject({ name: 'Free tote', unitPrice: formatMoney(0, 'en'), total: formatMoney(0, 'en') });
    expect(spaces(html(data))).toContain('Promotions applied (already included above)');
  });

  it('is an empty list without promotions and the template hides the block', () => {
    const data = build(makeOrder());
    expect(data.order.promotions).toEqual([]);
    expect(spaces(html(data))).not.toContain('Promotions');
  });

  it('shows names escaped, never the code, and no backoffice URLs', () => {
    const data = build(
      makeOrder({ promotions: [applied({ displayName: { en: '<b>Verão</b>' }, amount: 500 })] })
    );
    const out = html(data);
    expect(out).toContain('&lt;b&gt;Verão&lt;/b&gt;');
    expect(out).not.toContain('<b>Verão');
    expect(out).not.toContain('SECRET20');
    expect(out).not.toMatch(/\/admin|\/api\/|littlebox-strapi-suite/);
    expect(spaces(out)).toContain('Promotions');
  });
});
