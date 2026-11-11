import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATE_TYPES,
  getVariableCatalog,
  getSampleData,
} from '../../../../server/src/services/modules/ecommerce/email/catalog';
import { renderTemplate } from '../../../../server/src/services/modules/ecommerce/email/templateEngine';

const STORE = ['store.name', 'store.logoUrl', 'store.logoWidth', 'store.logoHeight', 'store.brandColor', 'store.url', 'store.supportEmail'];

const COMMON = [
  ...STORE,
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
    'order.promotions',
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
  EMAIL_VERIFICATION: ['verification.code', 'verification.validMinutes'],
};

/** EMAIL_VERIFICATION has no order or customer name: only the store and the e-mail address. */
const BASE: Record<string, string[]> = { EMAIL_VERIFICATION: [...STORE, 'customer.email'] };
const baseOf = (type: string) => BASE[type] ?? COMMON;

const resolve = (data: unknown, path: string) =>
  path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], data);

describe('email variable catalog', () => {
  it('exports the thirteen template types', () => {
    expect(EMAIL_TEMPLATE_TYPES).toHaveLength(13);
    expect([...EMAIL_TEMPLATE_TYPES].sort()).toEqual(Object.keys(SPECIFIC).sort());
  });

  it.each(Object.keys(SPECIFIC))('%s has exactly the common + specific variables', (type) => {
    const paths = getVariableCatalog(type as never).map((v) => v.path);
    expect([...paths].sort()).toEqual([...baseOf(type), ...SPECIFIC[type]].sort());
    for (const def of getVariableCatalog(type as never)) expect(def.description).toBeTruthy();
  });

  it('declares the allTracking list on FULL_SHIPMENT only', () => {
    const def = getVariableCatalog('FULL_SHIPMENT').find((v) => v.path === 'shipment.allTracking');
    expect(def).toMatchObject({ kind: 'list', itemFields: ['carrier', 'trackingCode', 'trackingUrl'] });
    expect(getVariableCatalog('PARTIAL_SHIPMENT').some((v) => v.path === 'shipment.allTracking')).toBe(false);
  });

  it('declares order.promotions on ORDER_CONFIRMATION only, with name and amount', () => {
    const def = getVariableCatalog('ORDER_CONFIRMATION').find((v) => v.path === 'order.promotions');
    expect(def).toMatchObject({ kind: 'list', itemFields: ['name', 'amount'] });
    for (const type of EMAIL_TEMPLATE_TYPES.filter((t) => t !== 'ORDER_CONFIRMATION')) {
      expect(getVariableCatalog(type).some((v) => v.path === 'order.promotions')).toBe(false);
    }
  });

  it('renders the promotions block with no backoffice or plugin URLs', async () => {
    const { DEFAULT_TEMPLATES } = await import(
      '../../../../server/src/services/modules/ecommerce/email/defaults'
    );
    const html = renderTemplate(
      DEFAULT_TEMPLATES.ORDER_CONFIRMATION.html,
      getSampleData('ORDER_CONFIRMATION')
    );
    expect(html).toContain('Summer Sale');
    expect(html).not.toMatch(/\/admin|\/api\/|littlebox-strapi-suite/);
  });

  it('EMAIL_VERIFICATION: sample data and a default that renders the code with no link or button', async () => {
    const { DEFAULT_TEMPLATES } = await import(
      '../../../../server/src/services/modules/ecommerce/email/defaults'
    );
    const data = getSampleData('EMAIL_VERIFICATION') as any;
    expect(data.verification).toEqual({ code: expect.stringMatching(/^\d{6}$/), validMinutes: '10' });
    expect(data.customer).toEqual({ email: expect.stringContaining('@') });
    expect(data.order).toBeUndefined();
    const { subject, html } = DEFAULT_TEMPLATES.EMAIL_VERIFICATION;
    expect(subject).toBe('Your verification code - {{store.name}}');
    expect(renderTemplate(subject, data)).toBe('Your verification code - Littlebox Store');
    const out = renderTemplate(html, data);
    expect(out).toContain(data.verification.code);
    expect(out).toContain('This code expires in 10 minutes.');
    expect(out).toContain('If you did not request it, ignore this e-mail.');
    expect(out).not.toMatch(/\/admin|\/api\/|littlebox-strapi-suite/);
    expect(html).not.toContain('class="ltb-btn"');
    // The only links are the layout footer's (support mailto and storefront URL).
    const body = html.slice(html.indexOf('<h1'), html.indexOf('Thank you,'));
    expect(body).not.toContain('<a ');
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
