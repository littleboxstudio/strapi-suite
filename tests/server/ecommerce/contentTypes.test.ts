import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';

const names: Record<string, string[]> = {
  'product': ['active', 'translations', 'variants', 'images'],
  'product-translation': ['product', 'locale', 'name', 'slug', 'shortDescription', 'description'],
  'variant': ['product', 'sku', 'price', 'tax', 'stock', 'weight', 'width', 'height', 'depth', 'active', 'position', 'translations', 'images'],
  'variant-translation': ['variant', 'locale', 'option'],
  'image': ['product', 'variant', 'position', 'name', 'width', 'height', 'sizeBytes', 'mime', 'ext', 'hash', 'url', 'provider', 'providerMetadata'],
};

describe('ecommerce catalog content-types', () => {
  for (const [name, attrs] of Object.entries(names)) {
    it(`${name} is registered and well formed`, () => {
      const schema: any = (contentTypes as any)[`ltb-st-module-ecommerce-${name}`]?.schema;
      expect(schema).toBeDefined();
      expect(schema.pluginOptions['content-manager'].visible).toBe(false);
      expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
      expect(schema.pluginOptions.i18n.localized).toBe(false);
      expect(schema.options.draftAndPublish).toBe(false);
      for (const a of attrs) expect(schema.attributes[a]).toBeDefined();
    });
  }

  it('variant sku is unique and image hash is unique', () => {
    const v: any = (contentTypes as any)['ltb-st-module-ecommerce-variant'].schema;
    expect(v.attributes.sku.unique).toBe(true);
    expect(v.attributes.sku.required).toBe(true);
    const i: any = (contentTypes as any)['ltb-st-module-ecommerce-image'].schema;
    expect(i.attributes.hash.unique).toBe(true);
  });

  it('product translation has unique locale+slug index', () => {
    const t: any = (contentTypes as any)['ltb-st-module-ecommerce-product-translation'].schema;
    expect(t.indexes).toContainEqual({ name: 'ecommerce_product_tr_locale_slug_unique', columns: ['locale', 'slug'], type: 'unique' });
  });

  it('relations use full UIDs with consistent inversedBy/mappedBy', () => {
    const p = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
    const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`].schema.attributes;
    const pairs: [string, string, string, string][] = [
      ['product', 'translations', 'product-translation', 'product'],
      ['product', 'variants', 'variant', 'product'],
      ['product', 'images', 'image', 'product'],
      ['variant', 'translations', 'variant-translation', 'variant'],
      ['variant', 'images', 'image', 'variant'],
    ];
    for (const [owner, attr, target, back] of pairs) {
      expect(get(owner)[attr].relation).toBe('oneToMany');
      expect(get(owner)[attr].target).toBe(p + target);
      expect(get(owner)[attr].mappedBy).toBe(back);
      expect(get(target)[back].relation).toBe('manyToOne');
      expect(get(target)[back].target).toBe(p + owner);
      expect(get(target)[back].inversedBy).toBe(attr);
    }
  });
});
