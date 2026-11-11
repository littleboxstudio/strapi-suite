import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const names: Record<string, string[]> = {
  'integration': ['providerId', 'category', 'active', 'config', 'secrets', 'updatedBy'],
  'store-setting': ['key', 'value'],
  'manual-shipping-method': ['name', 'price', 'tax', 'countries', 'active', 'position'],
  'email-template': ['type', 'locale', 'subject', 'html', 'version', 'updatedBy'],
  'email-template-version': ['type', 'locale', 'subject', 'html', 'version', 'createdBy'],
  'audit-log': ['area', 'action', 'targetId', 'userId', 'details'],
};

const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;

describe('ecommerce settings content-types', () => {
  for (const [name, attrs] of Object.entries(names)) {
    it(`${name} is registered, hidden and well formed`, () => {
      const schema = get(name);
      expect(schema).toBeDefined();
      expect(schema.info.singularName).toBe(`ltb-st-module-ecommerce-${name}`);
      expect(schema.collectionName).toBe(`ltb_st_module_ecommerce_${name.replace(/-/g, '_')}s`);
      expect(schema.pluginOptions['content-manager'].visible).toBe(false);
      expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
      expect(schema.options.draftAndPublish).toBe(false);
      for (const a of attrs) expect(schema.attributes[a]).toBeDefined();
    });
  }

  it('integration attributes', () => {
    const a = get('integration').attributes;
    expect(a.providerId).toMatchObject({ type: 'string', required: true, unique: true });
    expect(a.category).toMatchObject({ type: 'enumeration', required: true, enum: ['payment', 'billing', 'carrier', 'email'] });
    expect(a.active.default).toBe(false);
    expect(a.secrets.type).toBe('json');
  });

  it('store-setting key is unique', () => {
    expect(get('store-setting').attributes.key).toMatchObject({ required: true, unique: true });
  });

  it('manual-shipping-method defaults', () => {
    const a = get('manual-shipping-method').attributes;
    expect(a.price).toMatchObject({ type: 'integer', min: 0 });
    expect(a.tax).toMatchObject({ type: 'decimal', min: 0, max: 100, default: 23 });
    expect(a.countries.default).toEqual(['PT']);
    expect(a.active.default).toBe(true);
  });

  it('email-template has unique type+locale index and version default', () => {
    const s = get('email-template');
    expect(s.indexes).toContainEqual({ name: 'ecommerce_email_tpl_type_locale_unique', columns: ['type', 'locale'], type: 'unique' });
    expect(s.attributes.version.default).toBe(1);
  });

  it('registers the UIDs', () => {
    const uid = (config as any).default.uuid.modules.ecommerce;
    for (const [k, n] of Object.entries({
      integration: 'integration', storeSetting: 'store-setting', manualShippingMethod: 'manual-shipping-method',
      emailTemplate: 'email-template', emailTemplateVersion: 'email-template-version', auditLog: 'audit-log',
    })) {
      expect(uid[k]).toBe(`plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-${n}`);
    }
  });
});
