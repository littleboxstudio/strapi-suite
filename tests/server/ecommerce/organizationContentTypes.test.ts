import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;

const collections: Record<string, string> = {
  'product-category': 'ltb_st_module_ecommerce_product_categories',
  'product-category-translation': 'ltb_st_module_ecommerce_product_category_translations',
  'product-type': 'ltb_st_module_ecommerce_product_types',
  'product-type-translation': 'ltb_st_module_ecommerce_product_type_translations',
  'product-tag': 'ltb_st_module_ecommerce_product_tags',
  'product-tag-translation': 'ltb_st_module_ecommerce_product_tag_translations',
  collection: 'ltb_st_module_ecommerce_collections',
  'collection-translation': 'ltb_st_module_ecommerce_collection_translations',
  'collection-product': 'ltb_st_module_ecommerce_collection_products',
};
const configKeys: Record<string, string> = {
  category: 'product-category',
  categoryTranslation: 'product-category-translation',
  productType: 'product-type',
  productTypeTranslation: 'product-type-translation',
  tag: 'product-tag',
  tagTranslation: 'product-tag-translation',
  collection: 'collection',
  collectionTranslation: 'collection-translation',
  collectionProduct: 'collection-product',
};
const names: Record<string, string[]> = {
  'product-category': ['parent', 'children', 'position', 'active', 'image', 'translations', 'products'],
  'product-category-translation': ['category', 'locale', 'name', 'slug', 'description', 'seoTitle', 'seoDescription'],
  'product-type': ['key', 'translations', 'products'],
  'product-type-translation': ['productType', 'locale', 'name'],
  'product-tag': ['key', 'translations', 'products'],
  'product-tag-translation': ['tag', 'locale', 'name'],
  collection: ['type', 'sortOrder', 'active', 'image', 'match', 'conditions', 'translations', 'members'],
  'collection-translation': ['collection', 'locale', 'title', 'handle', 'description', 'seoTitle', 'seoDescription'],
  'collection-product': ['collection', 'product', 'position', 'uniqueKey'],
};

describe('ecommerce product organization content-types', () => {
  for (const [name, attrs] of Object.entries(names)) {
    it(`${name} is registered, hidden and well formed`, () => {
      const s = get(name);
      expect(s).toBeDefined();
      expect(s.kind).toBe('collectionType');
      expect(s.info.singularName).toBe(`ltb-st-module-ecommerce-${name}`);
      expect(s.collectionName).toBe(collections[name]);
      expect(s.pluginOptions['content-manager'].visible).toBe(false);
      expect(s.pluginOptions['content-type-builder'].visible).toBe(false);
      expect(s.pluginOptions.i18n.localized).toBe(false);
      expect(s.options.draftAndPublish).toBe(false);
      expect(Object.keys(s.attributes).sort()).toEqual([...attrs].sort());
      for (const i of s.indexes ?? []) expect(i.name.length).toBeLessThanOrEqual(60);
    });
  }

  it('registers the config uids', () => {
    const u = (config as any).default.uuid.modules.ecommerce;
    for (const [key, name] of Object.entries(configKeys)) expect(u[key]).toBe(`${P}${name}`);
  });

  it('one-to-many / many-to-one pairs are symmetric', () => {
    const pairs: [string, string, string, string][] = [
      ['product-category', 'translations', 'product-category-translation', 'category'],
      ['product-category', 'children', 'product-category', 'parent'],
      ['product-category', 'products', 'product', 'category'],
      ['product-type', 'translations', 'product-type-translation', 'productType'],
      ['product-type', 'products', 'product', 'productType'],
      ['product-tag', 'translations', 'product-tag-translation', 'tag'],
      ['collection', 'translations', 'collection-translation', 'collection'],
      ['collection', 'members', 'collection-product', 'collection'],
      ['product', 'collectionMembers', 'collection-product', 'product'],
    ];
    for (const [owner, attr, target, back] of pairs) {
      const o = get(owner).attributes[attr];
      const t = get(target).attributes[back];
      expect(o.relation).toBe('oneToMany');
      expect(o.target).toBe(P + target);
      expect(o.mappedBy).toBe(back);
      expect(t.relation).toBe('manyToOne');
      expect(t.target).toBe(P + owner);
      expect(t.inversedBy).toBe(attr);
    }
  });

  it('product tags and tag products are a symmetric many-to-many', () => {
    const tags = get('product').attributes.tags;
    const products = get('product-tag').attributes.products;
    expect(tags).toMatchObject({ type: 'relation', relation: 'manyToMany', target: `${P}product-tag`, inversedBy: 'products' });
    expect(products).toMatchObject({ type: 'relation', relation: 'manyToMany', target: `${P}product`, mappedBy: 'tags' });
  });

  it('has the unique indexes', () => {
    const idx = (n: string, name: string, columns: string[]) =>
      expect(get(n).indexes).toContainEqual({ name, columns, type: 'unique' });
    idx('product-category-translation', 'ecommerce_category_tr_locale_slug_unique', ['locale', 'slug']);
    idx('product-type', 'ecommerce_product_type_key_unique', ['key']);
    idx('product-tag', 'ecommerce_product_tag_key_unique', ['key']);
    idx('collection-translation', 'ecommerce_collection_tr_locale_handle_unique', ['locale', 'handle']);
    idx('collection-product', 'ecommerce_collection_product_unique_key_unique', ['unique_key']);
    expect(get('collection-product').attributes.uniqueKey).toMatchObject({ type: 'string', required: true, unique: true });
    expect(get('product-type').attributes.key).toMatchObject({ type: 'string', required: true, unique: true });
    expect(get('product-tag').attributes.key).toMatchObject({ type: 'string', required: true, unique: true });
  });

  it('attribute details', () => {
    const c = get('product-category').attributes;
    expect(c.parent).toMatchObject({ relation: 'manyToOne', inversedBy: 'children', target: `${P}product-category` });
    expect(c.position).toMatchObject({ type: 'integer', default: 0 });
    expect(c.active).toMatchObject({ type: 'boolean', default: true });
    expect(c.image.type).toBe('string');
    expect(c.image.required).toBeFalsy();
    const col = get('collection').attributes;
    expect(col.type).toMatchObject({ type: 'enumeration', enum: ['MANUAL', 'AUTOMATED'], required: true });
    expect(col.sortOrder.enum).toEqual(['MANUAL', 'BEST_SELLING', 'TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'NEWEST', 'OLDEST']);
    expect(col.match).toMatchObject({ enum: ['ALL', 'ANY'], default: 'ALL' });
    expect(col.conditions.type).toBe('json');
    expect(col.active).toMatchObject({ type: 'boolean', default: true });
    expect(get('collection-translation').attributes.title.required).toBe(true);
    expect(get('collection-translation').attributes.handle.required).toBe(true);
    expect(get('product-category-translation').attributes.name.required).toBe(true);
    expect(get('product-category-translation').attributes.slug.required).toBe(true);
    expect(get('collection-product').attributes.position).toMatchObject({ type: 'integer', default: 0 });
  });

  it('product and variant gain fields', () => {
    const p = get('product').attributes;
    expect(p.category).toMatchObject({ relation: 'manyToOne', target: `${P}product-category`, inversedBy: 'products' });
    expect(p.productType).toMatchObject({ relation: 'manyToOne', target: `${P}product-type`, inversedBy: 'products' });
    expect(p.tags).toBeDefined();
    expect(p.collectionMembers).toBeDefined();
    const v = get('variant').attributes.compareAtPrice;
    expect(v).toMatchObject({ type: 'integer', min: 0 });
    expect(v.required).toBeFalsy();
  });
});
