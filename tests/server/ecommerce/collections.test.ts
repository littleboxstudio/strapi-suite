import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceCollectionService from '../../../server/src/services/modules/ecommerce/collections';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  image: `${P}image`,
  category: `${P}product-category`,
  productType: `${P}product-type`,
  tag: `${P}product-tag`,
  collection: `${P}collection`,
  collectionTranslation: `${P}collection-translation`,
  collectionProduct: `${P}collection-product`,
  order: `${P}order`,
  orderLine: `${P}order-line`,
};

const RELATIONS: FakeRelations = {
  [UIDS.product]: {
    translations: [UIDS.productTranslation, 'product'],
    variants: [UIDS.variant, 'product'],
    images: [UIDS.image, 'product'],
    category: [UIDS.category, 'category', 'manyToOne'],
    productType: [UIDS.productType, 'productType', 'manyToOne'],
    tags: [UIDS.tag, 'product_tags', 'manyToMany'],
    collectionMembers: [UIDS.collectionProduct, 'product'],
  },
  [UIDS.variant]: { images: [UIDS.image, 'variant'] },
  [UIDS.tag]: { products: [UIDS.product, 'product_tags', 'manyToMany'] },
  [UIDS.collection]: {
    translations: [UIDS.collectionTranslation, 'collection'],
    members: [UIDS.collectionProduct, 'collection'],
  },
  [UIDS.collectionProduct]: {
    collection: [UIDS.collection, 'collection', 'manyToOne'],
    product: [UIDS.product, 'product', 'manyToOne'],
  },
  [UIDS.orderLine]: { order: [UIDS.order, 'order', 'manyToOne'] },
};

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, { enforceUnique: [UIDS.collectionProduct] });
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction, connection: db.connection, metadata: db.metadata },
    log: { warn: vi.fn() },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [
                { code: 'en', name: 'English' },
                { code: 'pt', name: 'Portuguese' },
              ],
            }),
          }
        : { service: () => undefined },
  };
  const service = EcommerceCollectionService({ strapi });
  const q = (uid: string) => db.query(uid);
  const product = async (name: string, price = 1000, extra: any = {}) => {
    const p = await q(UIDS.product).create({ data: { active: true, ...extra } });
    await q(UIDS.productTranslation).create({ data: { product: p.id, locale: 'en', name, slug: name.toLowerCase() } });
    await q(UIDS.variant).create({ data: { product: p.id, sku: `${name}-1`, price, active: true, position: 0 } });
    return p.id as number;
  };
  const tag = async (key: string) => (await q(UIDS.tag).create({ data: { key } })).id as number;
  return { service, db, q, strapi, product, tag };
}

type Setup = ReturnType<typeof setup>;

const manual = (title: string, extra: any = {}) => ({
  type: 'MANUAL',
  active: true,
  image: null,
  match: 'ALL',
  conditions: [],
  translations: { en: { title } },
  ...extra,
});

const automated = (title: string, extra: any = {}) => ({
  type: 'AUTOMATED',
  active: true,
  image: null,
  match: 'ALL',
  conditions: [{ field: 'PRICE', operator: 'gt', value: 500 }],
  translations: { en: { title } },
  ...extra,
});

const errorsOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(EcommerceValidationError);
    return (e as EcommerceValidationError).errors;
  }
  throw new Error('expected a validation error');
};

const members = async (s: Setup, collectionId: number) =>
  (await s.q(UIDS.collectionProduct).findMany({ where: { collection: { id: collectionId } }, orderBy: { position: 'asc' } }))
    .map((r: any) => r.product);

describe('EcommerceCollectionService — CRUD', () => {
  it('creates a manual collection with a handle generated from the title, MANUAL sort by default', async () => {
    const s = setup();
    const { id } = await s.service.create(manual('Summer Sale'));
    const detail = await s.service.get(id);
    expect(detail).toMatchObject({
      id,
      type: 'MANUAL',
      sortOrder: 'MANUAL',
      active: true,
      image: null,
      match: 'ALL',
      conditions: [],
      productCount: 0,
    });
    expect(detail.translations.en).toEqual({
      title: 'Summer Sale',
      handle: 'summer-sale',
      description: null,
      seoTitle: null,
      seoDescription: null,
    });
  });

  it('handles are unique per locale: a clash gets a suffix, another locale may reuse it', async () => {
    const s = setup();
    await s.service.create(manual('Summer'));
    const { id } = await s.service.create(manual('Summer', { translations: { en: { title: 'Summer' }, pt: { title: 'Summer' } } }));
    const detail = await s.service.get(id);
    expect(detail.translations.en.handle).toBe('summer-2');
    expect(detail.translations.pt.handle).toBe('summer');
  });

  it('refuses a requested handle already used in that locale', async () => {
    const s = setup();
    await s.service.create(manual('Summer'));
    const errors = await errorsOf(s.service.create(manual('Other', { translations: { en: { title: 'Other', handle: 'Summer' } } })));
    expect(errors).toEqual([{ path: 'translations.en.handle', code: 'duplicate_slug' }]);
    expect(s.db.tables[UIDS.collection]).toHaveLength(1);
  });

  it('keeps the handle stable on update unless one is given', async () => {
    const s = setup();
    const { id } = await s.service.create(manual('Summer'));
    await s.service.update(id, manual('Winter'));
    expect((await s.service.get(id)).translations.en).toMatchObject({ title: 'Winter', handle: 'summer' });
    await s.service.update(id, manual('Winter', { translations: { en: { title: 'Winter', handle: 'Winter Sale' } } }));
    expect((await s.service.get(id)).translations.en.handle).toBe('winter-sale');
  });

  it('validates title, locale, image and fields', async () => {
    const s = setup();
    const errors = await errorsOf(
      s.service.create(
        manual('', {
          type: 'OTHER',
          active: 'yes',
          image: 'javascript:alert(1)',
          sortOrder: 'RANDOM',
          translations: { en: { title: ' ', seoTitle: 'x'.repeat(256) }, fr: { title: 'X' } },
        })
      )
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { path: 'type', code: 'invalid' },
        { path: 'active', code: 'invalid' },
        { path: 'image', code: 'invalid_url' },
        { path: 'sortOrder', code: 'invalid' },
        { path: 'translations.en.seoTitle', code: 'too_long' },
        { path: 'translations.fr', code: 'invalid_locale' },
        { path: 'translations.en.title', code: 'required' },
      ])
    );
  });

  it('an automated collection defaults to NEWEST, needs at least one condition and refuses MANUAL sort', async () => {
    const s = setup();
    const { id } = await s.service.create(automated('Pricey'));
    expect(await s.service.get(id)).toMatchObject({
      type: 'AUTOMATED',
      sortOrder: 'NEWEST',
      conditions: [{ field: 'PRICE', operator: 'gt', value: 500 }],
    });
    expect(await errorsOf(s.service.create(automated('None', { conditions: [] })))).toEqual([
      { path: 'conditions', code: 'required' },
    ]);
    expect(await errorsOf(s.service.create(automated('Bad', { sortOrder: 'MANUAL' })))).toEqual([
      { path: 'sortOrder', code: 'invalid' },
    ]);
    expect(await errorsOf(s.service.update(id, automated('Pricey', { sortOrder: 'MANUAL' })))).toEqual([
      { path: 'sortOrder', code: 'invalid' },
    ]);
    expect(
      await errorsOf(s.service.create(automated('Bad', { conditions: [{ field: 'PRICE', operator: 'contains', value: 1 }] })))
    ).toEqual([{ path: 'conditions.0.operator', code: 'invalid_operator' }]);
  });

  it('refuses to change the type after creation', async () => {
    const s = setup();
    const { id } = await s.service.create(manual('Summer'));
    expect(await errorsOf(s.service.update(id, automated('Summer')))).toEqual([{ path: 'type', code: 'immutable' }]);
  });

  it('calls recalculate after an automated create and when match/conditions change, not otherwise', async () => {
    const s = setup();
    const recalculate = vi.fn(async () => undefined);
    (s.service as any).recalculate = recalculate;
    const { id } = await s.service.create(automated('Pricey'));
    expect(recalculate).toHaveBeenCalledWith(id);
    recalculate.mockClear();
    await s.service.update(id, automated('Pricey renamed', { sortOrder: 'TITLE_ASC' }));
    expect(recalculate).not.toHaveBeenCalled();
    await s.service.update(id, automated('Pricey', { match: 'ANY' }));
    expect(recalculate).toHaveBeenCalledWith(id);
    recalculate.mockClear();
    await s.service.create(manual('Manual'));
    expect(recalculate).not.toHaveBeenCalled();
  });

  it('lists collections with search, title in the locale and product count', async () => {
    const s = setup();
    const a = await s.product('A');
    const { id: summer } = await s.service.create(
      manual('Summer', { translations: { en: { title: 'Summer' }, pt: { title: 'Verão' } } })
    );
    await s.service.create(automated('Pricey'));
    await s.service.addProducts(summer, [a]);
    const all = await s.service.list({ page: 1, locale: 'pt' });
    expect(all.pagination).toMatchObject({ page: 1, total: 2 });
    expect(all.results.find((r: any) => r.id === summer)).toEqual({
      id: summer,
      title: 'Verão',
      handle: 'verao',
      type: 'MANUAL',
      active: true,
      productCount: 1,
    });
    const found = await s.service.list({ page: 1, search: 'pric' });
    expect(found.results.map((r: any) => r.title)).toEqual(['Pricey']);
  });

  it('get / update / delete of an unknown collection is not found', async () => {
    const s = setup();
    await expect(s.service.get(99)).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(s.service.update(99, manual('X'))).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(s.service.delete(99)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('delete removes members and translations but keeps the products', async () => {
    const s = setup();
    const a = await s.product('A');
    const b = await s.product('B');
    const { id } = await s.service.create(manual('Summer'));
    await s.service.addProducts(id, [a, b]);
    await s.service.delete(id);
    expect(s.db.tables[UIDS.collection]).toHaveLength(0);
    expect(s.db.tables[UIDS.collectionTranslation]).toHaveLength(0);
    expect(s.db.tables[UIDS.collectionProduct]).toHaveLength(0);
    expect(s.db.tables[UIDS.product].map((p: any) => p.id)).toEqual([a, b]);
  });
});

describe('EcommerceCollectionService — manual members', () => {
  it('adds products last (position max+1, uniqueKey), skipping existing members', async () => {
    const s = setup();
    const [a, b, c] = [await s.product('A'), await s.product('B'), await s.product('C')];
    const { id } = await s.service.create(manual('Summer'));
    await s.service.addProducts(id, [a, b]);
    await s.service.addProducts(id, [b, c]);
    const rows = s.db.tables[UIDS.collectionProduct];
    expect(rows.map((r: any) => [r.product, r.position, r.uniqueKey])).toEqual([
      [a, 0, `${id}:${a}`],
      [b, 1, `${id}:${b}`],
      [c, 2, `${id}:${c}`],
    ]);
  });

  it('refuses unknown product ids and malformed lists', async () => {
    const s = setup();
    const a = await s.product('A');
    const { id } = await s.service.create(manual('Summer'));
    expect(await errorsOf(s.service.addProducts(id, [a, 999]))).toEqual([{ path: 'productIds.1', code: 'unknown' }]);
    expect(await errorsOf(s.service.addProducts(id, 'x' as any))).toEqual([{ path: 'productIds', code: 'invalid' }]);
    expect(s.db.tables[UIDS.collectionProduct]).toHaveLength(0);
  });

  it('removes products and reorders the rest', async () => {
    const s = setup();
    const [a, b, c] = [await s.product('A'), await s.product('B'), await s.product('C')];
    const { id } = await s.service.create(manual('Summer'));
    await s.service.addProducts(id, [a, b, c]);
    await s.service.removeProducts(id, [b]);
    expect(await members(s, id)).toEqual([a, c]);
    await s.service.reorderProducts(id, [c, a]);
    expect(await members(s, id)).toEqual([c, a]);
    expect(s.db.tables[UIDS.product]).toHaveLength(3);
  });

  it('reorder requires a permutation of the current members', async () => {
    const s = setup();
    const [a, b, c] = [await s.product('A'), await s.product('B'), await s.product('C')];
    const { id } = await s.service.create(manual('Summer'));
    await s.service.addProducts(id, [a, b]);
    for (const ids of [[a], [a, b, c], [a, a], [b, c]]) {
      expect(await errorsOf(s.service.reorderProducts(id, ids))).toEqual([{ path: 'productIds', code: 'not_permutation' }]);
    }
    expect(await members(s, id)).toEqual([a, b]);
  });

  it('add / remove / reorder on an automated collection is COLLECTION_IS_AUTOMATED', async () => {
    const s = setup();
    // Priced below the rule (PRICE gt 500): the automated evaluation does not add it.
    const a = await s.product('A', 100);
    const { id } = await s.service.create(automated('Pricey'));
    for (const run of [
      () => s.service.addProducts(id, [a]),
      () => s.service.removeProducts(id, [a]),
      () => s.service.reorderProducts(id, [a]),
    ]) {
      expect(await errorsOf(run())).toEqual([{ path: 'collection', code: 'COLLECTION_IS_AUTOMATED' }]);
    }
    expect(s.db.tables[UIDS.collectionProduct]).toHaveLength(0);
  });

  it('ignores an unknown or malformed locale when sorting by title', async () => {
    const s = setup();
    const a = await s.product('Banana', 300);
    const b = await s.product('apple', 100);
    const { id } = await s.service.create(manual('Fruit', { sortOrder: 'TITLE_ASC' }));
    await s.service.addProducts(id, [a, b]);
    for (const locale of ['not a locale!!', 'xx', '']) {
      const r = await s.service.listProducts(id, { page: 1, locale });
      expect(r.results.map((e: any) => e.name)).toEqual(['apple', 'Banana']);
    }
  });

  it('lists members in the collection sort, paginated, with name and thumbnail', async () => {
    const s = setup();
    const a = await s.product('Banana', 300);
    const b = await s.product('apple', 100);
    const c = await s.product('Cherry', 200);
    await s.q(UIDS.image).create({ data: { product: b, url: '/b.jpg', position: 0 } });
    const { id } = await s.service.create(manual('Fruit'));
    await s.service.addProducts(id, [a, b, c]);
    const byManual = await s.service.listProducts(id, { page: 1 });
    expect(byManual.results).toEqual([
      { productId: a, name: 'Banana', thumbnailUrl: null, position: 0 },
      { productId: b, name: 'apple', thumbnailUrl: '/b.jpg', position: 1 },
      { productId: c, name: 'Cherry', thumbnailUrl: null, position: 2 },
    ]);
    expect(byManual.pagination).toEqual({ page: 1, pageSize: 50, total: 3, pageCount: 1 });
    await s.service.update(id, manual('Fruit', { sortOrder: 'TITLE_ASC' }));
    expect((await s.service.listProducts(id, { page: 1 })).results.map((r: any) => r.name)).toEqual([
      'apple',
      'Banana',
      'Cherry',
    ]);
    await s.service.update(id, manual('Fruit', { sortOrder: 'PRICE_DESC' }));
    expect((await s.service.listProducts(id, { page: 1 })).results.map((r: any) => r.productId)).toEqual([a, c, b]);
  });
});

describe('EcommerceCollectionService — member list pagination', () => {
  it('a 2nd page answers the right items and loads images only for that page', async () => {
    const s = setup();
    const ids: number[] = [];
    for (let i = 0; i < 52; i += 1) ids.push(await s.product(`P${String(i).padStart(2, '0')}`));
    await s.q(UIDS.image).create({ data: { product: ids[51], url: '/last.jpg', position: 0 } });
    const { id } = await s.service.create(manual('Big', { sortOrder: 'TITLE_DESC' }));
    await s.service.addProducts(id, ids.slice(0, 50));
    await s.service.addProducts(id, ids.slice(50));

    const imageLoads: any[] = [];
    const original = s.strapi.db.query;
    s.strapi.db.query = (uid: string) => {
      const q = original(uid);
      const spy = (method: 'findMany' | 'findOne') => async (p: any = {}) => {
        const pop = JSON.stringify(p.populate ?? {});
        if (pop.includes('images')) imageLoads.push({ uid, where: p.where });
        return q[method](p);
      };
      return { ...q, findMany: spy('findMany'), findOne: spy('findOne') };
    };

    // TITLE_DESC: P51, P50, ... P00 — page 2 holds P01 and P00.
    const second = await s.service.listProducts(id, { page: 2 });
    expect(second.results).toEqual([
      { productId: ids[1], name: 'P01', thumbnailUrl: null, position: 1 },
      { productId: ids[0], name: 'P00', thumbnailUrl: null, position: 0 },
    ]);
    expect(second.pagination).toEqual({ page: 2, pageSize: 50, total: 52, pageCount: 2 });
    expect(imageLoads).toEqual([{ uid: UIDS.product, where: { id: { $in: [ids[1], ids[0]] } } }]);

    const first = await s.service.listProducts(id, { page: 1 });
    expect(first.results[0]).toEqual({ productId: ids[51], name: 'P51', thumbnailUrl: '/last.jpg', position: 51 });
    expect(first.results).toHaveLength(50);
  });
});

describe('EcommerceCollectionService — bulk product actions', () => {
  it('addTag on 3 products links the tag once each, and syncs the changed products', async () => {
    const s = setup();
    const ids = [await s.product('A'), await s.product('B'), await s.product('C')];
    const sale = await s.tag('sale');
    const syncProducts = vi.fn(async () => undefined);
    (s.service as any).syncProducts = syncProducts;
    expect(await s.service.bulkProducts({ productIds: ids, action: 'addTag', value: sale })).toEqual({ updated: 3 });
    expect(await s.service.bulkProducts({ productIds: ids, action: 'addTag', value: sale })).toEqual({ updated: 0 });
    for (const id of ids) {
      const p = await s.q(UIDS.product).findOne({ where: { id }, populate: { tags: true } });
      expect(p.tags.map((t: any) => t.id)).toEqual([sale]);
    }
    expect(syncProducts).toHaveBeenCalledTimes(1);
    expect(syncProducts).toHaveBeenCalledWith(ids);
    expect(await s.service.bulkProducts({ productIds: [ids[0]], action: 'removeTag', value: sale })).toEqual({ updated: 1 });
    const first = await s.q(UIDS.product).findOne({ where: { id: ids[0] }, populate: { tags: true } });
    expect(first.tags).toEqual([]);
  });

  it('sets and clears the category and the product type', async () => {
    const s = setup();
    const ids = [await s.product('A'), await s.product('B')];
    const category = (await s.q(UIDS.category).create({ data: { position: 0, active: true } })).id;
    const type = (await s.q(UIDS.productType).create({ data: { key: 'shirt' } })).id;
    expect(await s.service.bulkProducts({ productIds: ids, action: 'setCategory', value: category })).toEqual({ updated: 2 });
    expect(await s.service.bulkProducts({ productIds: ids, action: 'setProductType', value: type })).toEqual({ updated: 2 });
    expect(s.db.tables[UIDS.product].map((p: any) => [p.category, p.productType])).toEqual([
      [category, type],
      [category, type],
    ]);
    expect(await s.service.bulkProducts({ productIds: ids, action: 'setCategory', value: null })).toEqual({ updated: 2 });
    expect(s.db.tables[UIDS.product].map((p: any) => p.category ?? null)).toEqual([null, null]);
  });

  it('adds to and removes from a manual collection; an automated one is COLLECTION_IS_AUTOMATED', async () => {
    const s = setup();
    const [a, b] = [await s.product('A'), await s.product('B')];
    const { id } = await s.service.create(manual('Summer'));
    await s.service.addProducts(id, [a]);
    expect(await s.service.bulkProducts({ productIds: [a, b], action: 'addToCollection', value: id })).toEqual({
      updated: 1,
    });
    expect(await members(s, id)).toEqual([a, b]);
    expect(await s.service.bulkProducts({ productIds: [a, b], action: 'removeFromCollection', value: id })).toEqual({
      updated: 2,
    });
    expect(await members(s, id)).toEqual([]);
    const { id: auto } = await s.service.create(automated('Pricey'));
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a], action: 'addToCollection', value: auto }))).toEqual([
      { path: 'value', code: 'COLLECTION_IS_AUTOMATED' },
    ]);
  });

  it('refuses more than 100 ids, unknown values and bad actions', async () => {
    const s = setup();
    const a = await s.product('A');
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(await errorsOf(s.service.bulkProducts({ productIds: many, action: 'addTag', value: 1 }))).toEqual([
      { path: 'productIds', code: 'too_many' },
    ]);
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a], action: 'addTag', value: 999 }))).toEqual([
      { path: 'value', code: 'unknown' },
    ]);
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a], action: 'setCategory', value: 999 }))).toEqual([
      { path: 'value', code: 'unknown' },
    ]);
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a], action: 'addTag', value: null }))).toEqual([
      { path: 'value', code: 'invalid' },
    ]);
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a], action: 'explode' as any, value: 1 }))).toEqual([
      { path: 'action', code: 'invalid' },
    ]);
    expect(await errorsOf(s.service.bulkProducts({ productIds: [], action: 'addTag', value: 1 }))).toEqual([
      { path: 'productIds', code: 'required' },
    ]);
    const sale = await s.tag('sale');
    expect(await errorsOf(s.service.bulkProducts({ productIds: [a, 999], action: 'addTag', value: sale }))).toEqual([
      { path: 'productIds.1', code: 'unknown' },
    ]);
  });
});
