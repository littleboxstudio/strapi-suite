import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;

const names: Record<string, string[]> = {
  refund: ['order', 'payment', 'method', 'kind', 'status', 'amount', 'currency', 'reason', 'description',
    'reference', 'externalId', 'idempotencyKey', 'storeCredit', 'actor', 'completedAt', 'metadata'],
  'store-credit': ['code', 'customer', 'emailNormalized', 'initialAmount', 'balance', 'currency', 'expiresAt',
    'status', 'sourceOrder', 'sourceRefund', 'conditions', 'actor'],
  'store-credit-movement': ['storeCredit', 'type', 'amount', 'order', 'payment', 'refund', 'operationKey', 'actor'],
  'stripe-session': ['order', 'payment', 'sessionId', 'paymentIntentId', 'url', 'amount', 'status', 'expiresAt',
    'purpose'],
  notification: ['order', 'type', 'eventId', 'uniqueKey', 'recipient', 'locale', 'status', 'providerMessageId',
    'error', 'attempts', 'sentAt', 'payload'],
  'webhook-event': ['provider', 'eventId', 'type', 'status', 'error'],
};

describe('ecommerce payments content-types', () => {
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

  it('registers the UIDs', () => {
    const u = (config as any).default.uuid.modules.ecommerce;
    expect(u.refund).toBe(`${P}refund`);
    expect(u.storeCredit).toBe(`${P}store-credit`);
    expect(u.storeCreditMovement).toBe(`${P}store-credit-movement`);
    expect(u.stripeSession).toBe(`${P}stripe-session`);
    expect(u.notification).toBe(`${P}notification`);
    expect(u.webhookEvent).toBe(`${P}webhook-event`);
  });

  it('refund', () => {
    const a = get('refund').attributes;
    expect(a.order).toMatchObject({ relation: 'manyToOne', target: `${P}order` });
    expect(a.payment).toMatchObject({ relation: 'manyToOne', target: `${P}payment` });
    expect(a.storeCredit).toMatchObject({ relation: 'manyToOne', target: `${P}store-credit` });
    expect(a.method.enum).toEqual(['MANUAL_TRANSFER', 'STORE_CREDIT', 'STRIPE']);
    expect(a.kind.enum).toEqual(['MONEY', 'STORE_CREDIT']);
    expect(a.status).toMatchObject({
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'PENDING',
    });
    expect(a.amount).toMatchObject({ type: 'integer', required: true });
    expect(a.idempotencyKey).toMatchObject({ type: 'string', unique: true });
    expect(a.metadata.type).toBe('json');
  });

  it('store-credit', () => {
    const s = get('store-credit');
    expect(s.attributes.code).toMatchObject({ type: 'string', required: true, unique: true });
    expect(s.attributes.status).toMatchObject({ enum: ['ACTIVE', 'VOID'], default: 'ACTIVE' });
    expect(s.attributes.expiresAt.type).toBe('datetime');
    expect(s.attributes.customer.relation).toBe('manyToOne');
    expect(s.indexes).toContainEqual({
      name: 'ecommerce_store_credit_email_idx', columns: ['email_normalized'],
    });
  });

  it('store-credit-movement', () => {
    const a = get('store-credit-movement').attributes;
    expect(a.type.enum).toEqual(['ISSUE', 'CONSUME', 'RESTORE', 'ADJUST']);
    expect(a.operationKey).toMatchObject({ required: true, unique: true });
    expect(a.storeCredit.target).toBe(`${P}store-credit`);
    expect(a.refund.target).toBe(`${P}refund`);
  });

  it('stripe-session', () => {
    const a = get('stripe-session').attributes;
    expect(a.sessionId).toMatchObject({ required: true, unique: true });
    expect(a.status).toMatchObject({ enum: ['OPEN', 'COMPLETE', 'EXPIRED'], default: 'OPEN' });
    expect(a.purpose.enum).toEqual(['CHECKOUT', 'SUPPLEMENTARY']);
  });

  it('notification', () => {
    const a = get('notification').attributes;
    expect(a.uniqueKey).toMatchObject({ required: true, unique: true });
    expect(a.status.enum).toEqual(['SENT', 'FAILED', 'SKIPPED']);
    expect(a.attempts).toMatchObject({ type: 'integer', default: 0 });
    expect(a.payload.type).toBe('json');
    expect(a.error.type).toBe('text');
  });

  it('webhook-event', () => {
    const a = get('webhook-event').attributes;
    expect(a.eventId).toMatchObject({ required: true, unique: true });
    expect(a.status.enum).toEqual(['PROCESSED', 'IGNORED', 'FAILED']);
  });
});
