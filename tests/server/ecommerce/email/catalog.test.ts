import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATE_TYPES,
  getVariableCatalog,
  getSampleData,
} from '../../../../server/src/services/modules/ecommerce/email/catalog';
import { renderTemplate } from '../../../../server/src/services/modules/ecommerce/email/templateEngine';

const COMMON = [
  'store.name',
  'store.logoUrl',
  'store.brandColor',
  'store.url',
  'store.supportEmail',
  'customer.firstName',
  'customer.lastName',
  'customer.email',
  'order.reference',
  'order.date',
];

const SPECIFIC: Record<string, string[]> = {
  ORDER_CONFIRMATION: [
    'order.items',
    'order.subtotal',
    'order.shipping',
    'order.discount',
    'order.total',
    'order.paymentStatus',
    'payment.link',
    'payment.amountDue',
    'payment.expiresAt',
  ],
  PAYMENT_CONFIRMATION: ['payment.amount', 'payment.method', 'payment.amountDue'],
  PAYMENT_INSTRUCTIONS: [
    'payment.amountDue',
    'payment.method',
    'payment.instructions',
    'payment.link',
    'payment.expiresAt',
  ],
  SUPPLEMENTARY_PAYMENT: [
    'payment.amountDue',
    'payment.method',
    'payment.instructions',
    'payment.link',
    'payment.expiresAt',
  ],
  PARTIAL_SHIPMENT: [
    'shipment.items',
    'shipment.pendingItems',
    'shipment.carrier',
    'shipment.trackingCode',
    'shipment.trackingUrl',
  ],
  FULL_SHIPMENT: [
    'shipment.items',
    'shipment.carrier',
    'shipment.trackingCode',
    'shipment.trackingUrl',
    'shipment.allTracking',
  ],
  DELIVERY_CONFIRMATION: ['delivery.date'],
  CANCELLATION: ['order.cancelledAt', 'order.amountPaid'],
  REFUND_STARTED: [
    'refund.amount',
    'refund.method',
    'refund.reference',
    'refund.isPartial',
    'refund.description',
  ],
  REFUND_COMPLETED: [
    'refund.amount',
    'refund.method',
    'refund.reference',
    'refund.isPartial',
    'refund.description',
  ],
  INVOICE_AVAILABLE: ['invoice.number'],
  STORE_CREDIT_ISSUED: ['credit.amount', 'credit.code', 'credit.expiresAt', 'credit.conditions'],
};

const resolve = (data: unknown, path: string) =>
  path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], data);

describe('email variable catalog', () => {
  it('exports the twelve template types', () => {
    expect([...EMAIL_TEMPLATE_TYPES].sort()).toEqual(Object.keys(SPECIFIC).sort());
  });

  it.each(Object.keys(SPECIFIC))('%s has exactly the common + specific variables', (type) => {
    const paths = getVariableCatalog(type as never).map((v) => v.path);
    expect([...paths].sort()).toEqual([...COMMON, ...SPECIFIC[type]].sort());
    for (const def of getVariableCatalog(type as never)) expect(def.description).toBeTruthy();
  });

  it('declares the allTracking list on FULL_SHIPMENT only', () => {
    const def = getVariableCatalog('FULL_SHIPMENT').find((v) => v.path === 'shipment.allTracking');
    expect(def).toMatchObject({ kind: 'list', itemFields: ['carrier', 'trackingCode', 'trackingUrl'] });
    expect(getVariableCatalog('PARTIAL_SHIPMENT').some((v) => v.path === 'shipment.allTracking')).toBe(false);
  });

  it('declares list item fields', () => {
    const items = getVariableCatalog('ORDER_CONFIRMATION').find((v) => v.path === 'order.items');
    expect(items).toMatchObject({
      kind: 'list',
      itemFields: ['name', 'option', 'sku', 'quantity', 'unitPrice', 'total'],
    });
    for (const path of ['shipment.items', 'shipment.pendingItems']) {
      const def = getVariableCatalog('PARTIAL_SHIPMENT').find((v) => v.path === path);
      expect(def).toMatchObject({
        kind: 'list',
        itemFields: ['name', 'option', 'sku', 'quantity'],
      });
    }
  });

  it.each(EMAIL_TEMPLATE_TYPES)('%s sample data covers every catalog variable', (type) => {
    const data = getSampleData(type);
    for (const def of getVariableCatalog(type)) {
      const value = resolve(data, def.path);
      expect(value, def.path).not.toBeUndefined();
      expect(value, def.path).not.toBeNull();
      expect(value, def.path).not.toBe('');
      if (def.kind === 'list') {
        expect(Array.isArray(value), def.path).toBe(true);
        const list = value as Record<string, unknown>[];
        expect(list.length).toBeGreaterThanOrEqual(2);
        if (def.itemFields?.includes('option')) {
          expect(list.filter((item) => item.option).length).toBeGreaterThanOrEqual(1);
        }
        for (const field of def.itemFields ?? []) {
          if (field === 'option') continue; // option may be absent on simple products
          for (const item of list) expect(item[field], `${def.path}.${field}`).not.toBe(undefined);
        }
      }
    }
  });

  it('uses fictional sample values', () => {
    expect(getSampleData('ORDER_CONFIRMATION')).toMatchObject({ customer: { firstName: 'João' } });
  });

  it('returns fresh copies', () => {
    const data = getSampleData('ORDER_CONFIRMATION') as { customer: { firstName: string } };
    data.customer.firstName = 'X';
    getVariableCatalog('ORDER_CONFIRMATION').pop();
    expect(getSampleData('ORDER_CONFIRMATION')).toMatchObject({ customer: { firstName: 'João' } });
    expect(getVariableCatalog('ORDER_CONFIRMATION')).toHaveLength(
      COMMON.length + SPECIFIC.ORDER_CONFIRMATION.length
    );
  });

  it('renders sample data through the engine', () => {
    const html = renderTemplate(
      '{{#each order.items}}{{this.name}}={{this.total}};{{/each}}',
      getSampleData('ORDER_CONFIRMATION')
    );
    expect(html.split(';').filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });
});
