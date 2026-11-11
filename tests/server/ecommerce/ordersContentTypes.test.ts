import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;

const names: Record<string, string[]> = {
  customer: ['firstName', 'lastName', 'email', 'emailNormalized', 'phone', 'orders'],
  order: ['reference', 'publicId', 'customer', 'locale', 'orderStatus', 'paymentStatus', 'fulfillmentStatus',
    'customerSnapshot', 'shippingAddress', 'billingAddress', 'currency', 'itemsOriginal', 'productDiscount',
    'subtotal', 'orderDiscount', 'shippingOriginal', 'shippingDiscount', 'shippingTotal', 'total', 'shippingTax',
    'shippingMethod', 'promotions', 'source', 'notes', 'idempotencyKey', 'cancelledAt', 'archivedAt',
    'lines', 'payments', 'history'],
  'order-line': ['order', 'variant', 'variantId', 'productId', 'sku', 'name', 'option', 'imageUrl', 'unitPrice',
    'unitDiscount', 'quantity', 'returnedQuantity', 'tax', 'isGift', 'promotionRefs', 'position'],
  payment: ['order', 'method', 'status', 'amount', 'currency', 'reference', 'externalId', 'idempotencyKey',
    'coverage', 'completedAt', 'actor', 'metadata'],
  'stock-movement': ['variant', 'variantId', 'order', 'type', 'quantity', 'operationKey', 'reason', 'actor'],
  'order-history': ['order', 'type', 'description', 'previousValue', 'newValue', 'actor', 'operationId'],
};

describe('ecommerce orders content-types', () => {
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
      for (const a of attrs) expect(schema.attributes[a]).toBeDefined();
    });
  }

  it('customer', () => {
    const s = get('customer');
    expect(s.attributes.emailNormalized).toMatchObject({ type: 'string', required: true });
    expect(s.indexes).toContainEqual({ name: 'ecommerce_customer_email_idx', columns: ['email_normalized'] });
    expect(s.attributes.orders).toMatchObject({ relation: 'oneToMany', target: `${P}order`, mappedBy: 'customer' });
  });

  it('order identification, states and defaults', () => {
    const a = get('order').attributes;
    expect(a.reference).toMatchObject({ type: 'integer', required: true, unique: true });
    expect(a.publicId).toMatchObject({ type: 'string', required: true, unique: true });
    expect(a.idempotencyKey).toMatchObject({ type: 'string', unique: true });
    expect(a.orderStatus).toMatchObject({ type: 'enumeration', enum: ['OPEN', 'ARCHIVED', 'CANCELLED'], default: 'OPEN' });
    expect(a.paymentStatus.default).toBe('PENDING');
    expect(a.fulfillmentStatus.default).toBe('UNFULFILLED');
    expect(a.source.enum).toEqual(['admin', 'storefront']);
    expect(a.currency.default).toBe('EUR');
    expect(a.promotions).toMatchObject({ type: 'json', default: [] });
    expect(a.shippingTax.type).toBe('decimal');
    for (const k of ['customerSnapshot', 'shippingAddress', 'billingAddress', 'shippingMethod']) {
      expect(a[k].type).toBe('json');
    }
  });

  it('order relations are bidirectional with full uids', () => {
    const a = get('order').attributes;
    expect(a.customer).toMatchObject({ relation: 'manyToOne', target: `${P}customer`, inversedBy: 'orders' });
    expect(a.lines).toMatchObject({ relation: 'oneToMany', target: `${P}order-line`, mappedBy: 'order' });
    expect(a.payments).toMatchObject({ relation: 'oneToMany', target: `${P}payment`, mappedBy: 'order' });
    expect(a.history).toMatchObject({ relation: 'oneToMany', target: `${P}order-history`, mappedBy: 'order' });
    for (const n of ['order-line', 'payment', 'order-history']) {
      expect(get(n).attributes.order).toMatchObject({
        relation: 'manyToOne', target: `${P}order`, inversedBy: n === 'order-line' ? 'lines' : n === 'payment' ? 'payments' : 'history',
      });
    }
  });

  it('order-line, payment, stock-movement, order-history details', () => {
    const l = get('order-line').attributes;
    expect(l.variant).toMatchObject({ relation: 'manyToOne', target: `${P}variant` });
    expect(l.variant.inversedBy).toBeUndefined();
    expect(l.unitDiscount.default).toBe(0);
    expect(l.quantity).toMatchObject({ type: 'integer', required: true });
    expect(l.returnedQuantity.default).toBe(0);
    expect(l.isGift.default).toBe(false);
    expect(l.promotionRefs).toMatchObject({ type: 'json', default: [] });

    const p = get('payment').attributes;
    expect(p.method.enum).toEqual(['STRIPE', 'MANUAL', 'STORE_CREDIT']);
    expect(p.status.enum).toEqual(['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']);
    expect(p.amount).toMatchObject({ type: 'integer', required: true });
    expect(p.idempotencyKey).toMatchObject({ type: 'string', unique: true });
    expect(p.createdBy).toBeUndefined();

    const m = get('stock-movement').attributes;
    expect(m.type.enum).toEqual(['ORDER_DEDUCT', 'ORDER_RESTOCK', 'CANCEL_RESTOCK', 'RETURN_RESTOCK', 'RETURN_NO_RESTOCK', 'MANUAL_ADJUST']);
    expect(m.operationKey).toMatchObject({ type: 'string', required: true, unique: true });
    expect(m.variant).toMatchObject({ relation: 'manyToOne', target: `${P}variant` });
    expect(m.variant.inversedBy).toBeUndefined();
    expect(m.order).toMatchObject({ relation: 'manyToOne', target: `${P}order` });

    const h = get('order-history').attributes;
    expect(h.type).toMatchObject({ type: 'string', required: true });
  });

  it('payment status enums of the order', () => {
    const a = get('order').attributes;
    expect(a.paymentStatus.enum).toHaveLength(5);
    expect(a.fulfillmentStatus.enum).toHaveLength(3);
  });

  it('registers the UIDs', () => {
    const uid = (config as any).default.uuid.modules.ecommerce;
    for (const [k, n] of Object.entries({
      customer: 'customer', order: 'order', orderLine: 'order-line', payment: 'payment',
      stockMovement: 'stock-movement', orderHistory: 'order-history',
    })) {
      expect(uid[k]).toBe(`${P}${n}`);
    }
  });
});
