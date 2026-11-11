import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;
const RESERVED = ['createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'publishedAt', 'id', 'documentId', 'locale'];

const names: Record<string, string[]> = {
  promotion: ['name', 'description', 'code', 'method', 'active', 'startsAt', 'endsAt', 'priority', 'displayName',
    'eligibility', 'conditions', 'benefits', 'stacking', 'usageLimit', 'perCustomerLimit', 'perOrderLimit',
    'redemptions', 'version', 'actor', 'requireVerifiedEmail'],
  'promotion-redemption': ['promotion', 'order', 'customer', 'emailNormalized', 'promotionCode', 'amount', 'status',
    'releasedAt', 'uniqueKey', 'actor'],
  'promotion-customer-usage': ['promotion', 'emailNormalized', 'uses', 'uniqueKey'],
};
const collections: Record<string, string> = {
  promotion: 'ltb_st_module_ecommerce_promotions',
  'promotion-redemption': 'ltb_st_module_ecommerce_promotion_redemptions',
  'promotion-customer-usage': 'ltb_st_module_ecommerce_promotion_customer_usages',
};

describe('ecommerce promotion content-types', () => {
  for (const [name, attrs] of Object.entries(names)) {
    it(`${name} is registered, hidden and well formed`, () => {
      const schema = get(name);
      expect(schema).toBeDefined();
      expect(schema.info.singularName).toBe(`ltb-st-module-ecommerce-${name}`);
      expect(schema.collectionName).toBe(collections[name]);
      expect(schema.pluginOptions['content-manager'].visible).toBe(false);
      expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
      expect(schema.pluginOptions.i18n.localized).toBe(false);
      expect(schema.options.draftAndPublish).toBe(false);
      expect(Object.keys(schema.attributes).sort()).toEqual([...attrs].sort());
      for (const r of RESERVED) expect(schema.attributes[r]).toBeUndefined();
      for (const i of schema.indexes ?? []) expect(i.name.length).toBeLessThanOrEqual(60);
    });
  }

  it('registers the UIDs', () => {
    const u = (config as any).default.uuid.modules.ecommerce;
    expect(u.promotion).toBe(`${P}promotion`);
    expect(u.promotionRedemption).toBe(`${P}promotion-redemption`);
    expect(u.promotionCustomerUsage).toBe(`${P}promotion-customer-usage`);
  });

  it('promotion', () => {
    const s = get('promotion');
    const a = s.attributes;
    expect(a.name).toMatchObject({ type: 'string', required: true });
    expect(a.description.type).toBe('text');
    expect(a.code).toMatchObject({ type: 'string', unique: true });
    expect(a.code.required).toBeFalsy();
    expect(a.method).toMatchObject({ enum: ['AUTOMATIC', 'CODE'], required: true });
    expect(a.active).toMatchObject({ type: 'boolean', default: false });
    expect(a.startsAt).toMatchObject({ type: 'datetime', required: true });
    expect(a.endsAt.type).toBe('datetime');
    expect(a.priority).toMatchObject({ type: 'integer', default: 0 });
    for (const j of ['displayName', 'eligibility', 'conditions', 'benefits', 'stacking']) {
      expect(a[j].type).toBe('json');
    }
    for (const n of ['usageLimit', 'perCustomerLimit', 'perOrderLimit']) {
      expect(a[n].type).toBe('integer');
      expect(a[n].default).toBeUndefined();
    }
    expect(a.redemptions).toMatchObject({ type: 'integer', default: 0 });
    expect(a.version).toMatchObject({ type: 'integer', default: 1 });
    expect(a.actor.type).toBe('string');
    expect(s.indexes).toEqual(
      expect.arrayContaining([
        { name: 'ecommerce_promotion_code_unique', columns: ['code'], type: 'unique' },
        { name: 'ecommerce_promotion_method_active_idx', columns: ['method', 'active'] },
      ])
    );
  });

  it('promotion-redemption', () => {
    const s = get('promotion-redemption');
    const a = s.attributes;
    for (const r of ['promotion', 'order', 'customer']) {
      expect(a[r]).toMatchObject({ type: 'relation', relation: 'manyToOne', target: `${P}${r}` });
    }
    expect(a.status).toMatchObject({ enum: ['RESERVED', 'RELEASED'], default: 'RESERVED' });
    expect(a.amount.type).toBe('integer');
    expect(a.releasedAt.type).toBe('datetime');
    expect(a.uniqueKey).toMatchObject({ type: 'string', required: true, unique: true });
    expect(s.indexes).toEqual([
      { name: 'ecommerce_promo_redemption_key_unique', columns: ['unique_key'], type: 'unique' },
    ]);
  });

  it('promotion-customer-usage', () => {
    const s = get('promotion-customer-usage');
    const a = s.attributes;
    expect(a.promotion).toMatchObject({ relation: 'manyToOne', target: `${P}promotion` });
    expect(a.uses).toMatchObject({ type: 'integer', default: 0 });
    expect(a.uniqueKey).toMatchObject({ type: 'string', required: true, unique: true });
    expect(s.indexes).toEqual([
      { name: 'ecommerce_promo_usage_key_unique', columns: ['unique_key'], type: 'unique' },
    ]);
  });
});
