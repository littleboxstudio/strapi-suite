import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;

const names: Record<string, string[]> = {
  shipment: ['order', 'providerId', 'serviceId', 'carrierName', 'status', 'items', 'trackingCode', 'trackingUrl',
    'externalId', 'shippingCost', 'labelAvailable', 'deliveryStatus', 'deliverySource', 'shippedAt', 'deliveredAt',
    'cancelledAt', 'idempotencyKey', 'actor', 'error', 'metadata'],
  'shipment-event': ['shipment', 'order', 'type', 'code', 'description', 'occurredAt', 'source', 'actor', 'uniqueKey'],
  'order-return': ['order', 'items', 'grossValue', 'discountShare', 'refundableValue', 'reason', 'notes',
    'idempotencyKey', 'actor'],
  invoice: ['order', 'provider', 'kind', 'documentType', 'status', 'externalId', 'number', 'series', 'total', 'lines',
    'customerData', 'creditedInvoice', 'idempotencyKey', 'ourReference', 'issuedAt', 'error', 'actor', 'metadata'],
  'invoice-allocation': ['invoice', 'payment', 'order', 'amount', 'coverage', 'uniqueKey'],
};

const RESERVED = ['createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'publishedAt', 'id', 'documentId', 'locale'];

describe('ecommerce fulfillment content-types', () => {
  for (const [name, attrs] of Object.entries(names)) {
    it(`${name} is registered, hidden and well formed`, () => {
      const schema = get(name);
      expect(schema).toBeDefined();
      expect(schema.info.singularName).toBe(`ltb-st-module-ecommerce-${name}`);
      expect(schema.collectionName).toBe(`ltb_st_module_ecommerce_${name.replace(/-/g, '_')}s`);
      expect(schema.pluginOptions['content-manager'].visible).toBe(false);
      expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
      expect(schema.pluginOptions.i18n.localized).toBe(false);
      expect(schema.options.draftAndPublish).toBe(false);
      expect(Object.keys(schema.attributes).sort()).toEqual([...attrs].sort());
      for (const r of RESERVED) expect(schema.attributes[r]).toBeUndefined();
    });
  }

  it('registers the UIDs', () => {
    const u = (config as any).default.uuid.modules.ecommerce;
    expect(u.shipment).toBe(`${P}shipment`);
    expect(u.shipmentEvent).toBe(`${P}shipment-event`);
    expect(u.orderReturn).toBe(`${P}order-return`);
    expect(u.invoice).toBe(`${P}invoice`);
    expect(u.invoiceAllocation).toBe(`${P}invoice-allocation`);
  });

  it('shipment', () => {
    const a = get('shipment').attributes;
    expect(a.order).toMatchObject({ relation: 'manyToOne', target: `${P}order` });
    expect(a.status).toMatchObject({ enum: ['PENDING', 'ACTIVE', 'FAILED', 'CANCELLED'], default: 'PENDING' });
    expect(a.deliveryStatus).toMatchObject({ enum: ['IN_TRANSIT', 'DELIVERED', 'EXCEPTION'], default: 'IN_TRANSIT' });
    expect(a.deliverySource.enum).toEqual(['MANUAL', 'CARRIER']);
    expect(a.items.type).toBe('json');
    expect(a.trackingUrl.type).toBe('text');
    expect(a.shippingCost).toMatchObject({ type: 'integer', default: 0 });
    expect(a.labelAvailable).toMatchObject({ type: 'boolean', default: false });
    expect(a.providerId.required).toBe(true);
    expect(a.carrierName.required).toBe(true);
    expect(a.idempotencyKey).toMatchObject({ type: 'string', required: true, unique: true });
  });

  it('shipment-event', () => {
    const a = get('shipment-event').attributes;
    expect(a.shipment.target).toBe(`${P}shipment`);
    expect(a.type.enum).toEqual(['CREATED', 'TRACKING', 'DELIVERED', 'TRACKING_UPDATED', 'CANCELLED']);
    expect(a.source.enum).toEqual(['ADMIN', 'CARRIER', 'SYSTEM']);
    expect(a.uniqueKey).toMatchObject({ required: true, unique: true });
  });

  it('order-return', () => {
    const a = get('order-return').attributes;
    expect(a.items.type).toBe('json');
    expect(a.refundableValue.type).toBe('integer');
    expect(a.idempotencyKey).toMatchObject({ required: true, unique: true });
  });

  it('invoice', () => {
    const a = get('invoice').attributes;
    expect(a.kind.enum).toEqual(['INVOICE', 'CREDIT_NOTE']);
    expect(a.status).toMatchObject({ enum: ['PENDING', 'ISSUED', 'FAILED', 'UNCERTAIN'], default: 'PENDING' });
    expect(a.creditedInvoice).toMatchObject({ relation: 'manyToOne', target: `${P}invoice` });
    expect(a.lines.type).toBe('json');
    expect(a.customerData.type).toBe('json');
    expect(a.idempotencyKey).toMatchObject({ required: true, unique: true });
  });

  it('invoice-allocation has a nullable unique key', () => {
    const s = get('invoice-allocation');
    expect(s.attributes.uniqueKey).toMatchObject({ type: 'string', unique: true });
    expect(s.attributes.uniqueKey.required).toBeUndefined();
    expect(s.attributes.coverage.type).toBe('json');
    expect(s.attributes.invoice.target).toBe(`${P}invoice`);
    expect(s.attributes.payment.target).toBe(`${P}payment`);
  });
});
