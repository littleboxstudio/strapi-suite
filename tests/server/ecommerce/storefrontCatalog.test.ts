import { describe, it, expect } from 'vitest';
import EcommerceStorefrontCatalogService from '../../../server/src/services/modules/ecommerce/storefrontCatalog';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  variantTranslation: `${P}variant-translation`,
  image: `${P}image`,
  category: `${P}product-category`,
  categoryTranslation: `${P}product-category-translation`,
  productType: `${P}product-type`,
  productTypeTranslation: `${P}product-type-translation`,
  tag: `${P}product-tag`,
  tagTranslation: `${P}product-tag-translation`,
  collection: `${P}collection`,
  collectionTranslation: `${P}collection-translation`,
  collectionProduct: `${P}collection-product`,
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
  [UIDS.variant]: {
    translations: [UIDS.variantTranslation, 'variant'],
    images: [UIDS.image, 'variant'],
  },
  [UIDS.category]: {
    parent: [UIDS.category, 'parent', 'manyToOne'],
    translations: [UIDS.categoryTranslation, 'category'],
  },
  [UIDS.productType]: { translations: [UIDS.productTypeTranslation, 'productType'] },
  [UIDS.tag]: {
    translations: [UIDS.tagTranslation, 'tag'],
    products: [UIDS.product, 'product_tags', 'manyToMany'],
  },
  [UIDS.collection]: {
    translations: [UIDS.collectionTranslation, 'collection'],
    members: [UIDS.collectionProduct, 'collection'],
  },
  [UIDS.collectionProduct]: {
    collection: [UIDS.collection, 'collection', 'manyToOne'],
    product: [UIDS.product, 'product', 'manyToOne'],
  },
};

function setup(opts: { duplicateRows?: boolean } = {}) {
  const fake = createFakeDb(Object.values(UIDS), RELATIONS);
  const { tables } = fake;
  const query = opts.duplicateRows
    ? (uid: string) => {
        const q = fake.query(uid);
        return {
          ...q,
          // A join on a to-many relation can repeat a product row.
          findMany: async (p: any) => {
            const rows = await q.findMany(p);
            return [...rows, ...rows];
          },
        };
      }
    : fake.query;
  const strapi: any = {
    db: { query },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [{ code: 'en' }, { code: 'pt' }],
            }),
          }
        : {
            service: (name: string) =>
              name === 'EcommerceCollectionService'
                ? { unitsSoldByProduct: async (ids: number[]) => new Map(ids.map((i) => [i, sold.get(i) ?? 0])) }
                : undefined,
          },
  };
  /** Units sold per product id, as EcommerceCollectionService.unitsSoldByProduct answers. */
  const sold = new Map<number, number>();
  const service = EcommerceStorefrontCatalogService({ strapi });
  let pid = 0;
  let vid = 0;
  let iid = 0;
  const addProduct = (o: {
    name: string;
    pt?: string;
    active?: boolean;
    images?: string[];
    variants: {
      sku: string;
      price: number;
      stock?: number;
      active?: boolean;
      images?: string[];
      option?: string;
      compareAtPrice?: number | null;
    }[];
  }) => {
    pid += 1;
    tables[UIDS.product].push({ id: pid, active: o.active ?? true });
    const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    tables[UIDS.productTranslation].push({
      id: pid * 10,
      product: pid,
      locale: 'en',
      name: o.name,
      slug,
      shortDescription: `short ${o.name}`,
      description: '<p>d</p>',
    });
    if (o.pt)
      tables[UIDS.productTranslation].push({
        id: pid * 10 + 1,
        product: pid,
        locale: 'pt',
        name: o.pt,
        slug: `${slug}-pt`,
        shortDescription: 's',
        description: '<p>pt</p>',
      });
    (o.images ?? []).forEach((url, i) => {
      iid += 1;
      tables[UIDS.image].push({ id: iid, product: pid, url, width: 10, height: 20, position: i, hash: 'secret' });
    });
    o.variants.forEach((v, i) => {
      vid += 1;
      tables[UIDS.variant].push({
        id: vid,
        product: pid,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        tax: 23,
        stock: v.stock ?? 5,
        weight: 1,
        active: v.active ?? true,
        position: i,
      });
      tables[UIDS.variantTranslation].push({
        id: vid,
        variant: vid,
        locale: 'en',
        option: v.option ?? 'M',
      });
      (v.images ?? []).forEach((url, j) => {
        iid += 1;
        tables[UIDS.image].push({ id: iid, variant: vid, url, width: 1, height: 2, position: j });
      });
    });
    return pid;
  };
  let seq = 1000;
  const next = () => ++seq;
  type Texts = Record<string, Record<string, string>>;
  const addCategory = (o: { texts: Texts; parent?: number; active?: boolean; position?: number }) => {
    const id = next();
    tables[UIDS.category].push({
      id,
      parent: o.parent ?? null,
      active: o.active ?? true,
      position: o.position ?? 0,
    });
    for (const [locale, t] of Object.entries(o.texts))
      tables[UIDS.categoryTranslation].push({ id: next(), category: id, locale, ...t });
    return id;
  };
  const addType = (names: Record<string, string>) => {
    const id = next();
    tables[UIDS.productType].push({ id, key: names.en.toLowerCase() });
    for (const [locale, name] of Object.entries(names))
      tables[UIDS.productTypeTranslation].push({ id: next(), productType: id, locale, name });
    return id;
  };
  const addTag = (names: Record<string, string>) => {
    const id = next();
    tables[UIDS.tag].push({ id, key: names.en.toLowerCase() });
    for (const [locale, name] of Object.entries(names))
      tables[UIDS.tagTranslation].push({ id: next(), tag: id, locale, name });
    return id;
  };
  const addCollection = (o: {
    texts: Texts;
    active?: boolean;
    sortOrder?: string;
    image?: string;
    members?: number[];
  }) => {
    const id = next();
    tables[UIDS.collection].push({
      id,
      type: 'AUTOMATED',
      sortOrder: o.sortOrder ?? 'MANUAL',
      active: o.active ?? true,
      match: 'ALL',
      conditions: [{ field: 'TITLE', operator: 'eq', value: 'secret-rule' }],
    });
    for (const [locale, t] of Object.entries(o.texts))
      tables[UIDS.collectionTranslation].push({ id: next(), collection: id, locale, ...t });
    (o.members ?? []).forEach((product, position) =>
      tables[UIDS.collectionProduct].push({ id: next(), collection: id, product, position })
    );
    return id;
  };
  const organize = async (
    pid: number,
    o: { category?: number; productType?: number; tags?: number[] }
  ) => {
    const row = tables[UIDS.product].find((p: any) => p.id === pid);
    if (o.category !== undefined) row.category = o.category;
    if (o.productType !== undefined) row.productType = o.productType;
    if (o.tags) await fake.query(UIDS.product).update({ where: { id: pid }, data: { tags: { set: o.tags } } });
  };
  return { service, addProduct, tables, sold, addCategory, addType, addTag, addCollection, organize };
}

const v = (sku: string, price = 1000, extra: any = {}) => ({ sku, price, ...extra });

describe('EcommerceStorefrontCatalogService', () => {
  it('resolveLocale: default when empty, 400 when unknown', async () => {
    const { service } = setup();
    expect(await service.resolveLocale(undefined)).toBe('en');
    expect(await service.resolveLocale('')).toBe('en');
    expect(await service.resolveLocale('pt')).toBe('pt');
    const err: any = await service.resolveLocale('fr').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'locale', code: 'invalid_locale' }]);
  });

  it('hides inactive products and products with only inactive variants', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: 'Visible', variants: [v('A')] });
    addProduct({ name: 'Off', active: false, variants: [v('B')] });
    addProduct({ name: 'NoVariants', variants: [v('C', 1000, { active: false })] });
    const res = await service.listProducts({ locale: 'en' });
    expect(res.results.map((r) => r.name)).toEqual(['Visible']);
    expect(res.pagination).toEqual({ page: 1, pageSize: 24, total: 1, pageCount: 1 });
    await expect(service.getProduct('off', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.getProduct('novariants', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.getProduct('nope', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('available flag, no stock counts, inactive variant ignored in prices', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: 'Mixed', variants: [v('M1', 2000, { stock: 0 }), v('M2', 3000, { stock: 7 }), v('M3', 100, { active: false })] });
    addProduct({ name: 'Sold', variants: [v('S1', 500, { stock: 0 }), v('S2', 600, { stock: -2 })] });
    const res = await service.listProducts({ locale: 'en', sort: 'name_asc' });
    const mixed = res.results.find((r) => r.name === 'Mixed')!;
    const sold = res.results.find((r) => r.name === 'Sold')!;
    expect(mixed).toMatchObject({ priceMin: 2000, priceMax: 3000, available: true, currency: 'EUR' });
    expect(sold.available).toBe(false);
    const detail = await service.getProduct('mixed', 'en');
    expect(detail.variants.map((x) => [x.sku, x.available, x.taxRate])).toEqual([
      ['M1', false, 23],
      ['M2', true, 23],
    ]);
    const json = JSON.stringify([res, detail]);
    expect(json).not.toContain('stock');
    expect(json).not.toContain('weight');
    expect(json).not.toContain('secret');
  });

  it('search: % is literal-safe and finds by name or SKU', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: '50 Anos', variants: [v('ANO-1')] });
    addProduct({ name: 'Other', variants: [v('OTH-1')] });
    addProduct({ name: 'Hidden', variants: [v('HID-1', 1, { active: false }), v('OK-1')] });
    expect((await service.listProducts({ locale: 'en', search: '50%' })).results.map((r) => r.name)).toEqual(['50 Anos']);
    expect((await service.listProducts({ locale: 'en', search: 'oth-1' })).results.map((r) => r.name)).toEqual(['Other']);
    expect((await service.listProducts({ locale: 'en', search: 'hid-1' })).results).toHaveLength(0);
    expect((await service.listProducts({ locale: 'en', search: '%' })).results).toHaveLength(3);
  });

  it('sort price_desc paginates consistently; invalid sort and paging bounds', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: 'A', variants: [v('A1', 1000)] });
    addProduct({ name: 'B', variants: [v('B1', 3000)] });
    addProduct({ name: 'C', variants: [v('C1', 2000)] });
    const p1 = await service.listProducts({ locale: 'en', sort: 'price_desc', pageSize: 2, page: 1 });
    const p2 = await service.listProducts({ locale: 'en', sort: 'price_desc', pageSize: 2, page: 2 });
    expect(p1.results.map((r) => r.name)).toEqual(['B', 'C']);
    expect(p2.results.map((r) => r.name)).toEqual(['A']);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 3, pageCount: 2 });
    const asc = await service.listProducts({ locale: 'en', sort: 'price_asc' });
    expect(asc.results.map((r) => r.name)).toEqual(['A', 'C', 'B']);
    const newest = await service.listProducts({ locale: 'en' });
    expect(newest.results.map((r) => r.name)).toEqual(['C', 'B', 'A']);
    const err: any = await service.listProducts({ locale: 'en', sort: 'foo' }).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'sort', code: 'invalid_sort' }]);
    expect((await service.listProducts({ locale: 'en', pageSize: 500 }).catch((e: any) => e)).errors?.[0].path).toBe('pageSize');
    expect((await service.listProducts({ locale: 'en', page: 0 }).catch((e: any) => e)).errors?.[0].path).toBe('page');
  });

  it('falls back to default locale texts and accepts the default-locale slug', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: 'Shirt', variants: [v('SH-1')] });
    addProduct({ name: 'Pants', pt: 'Calças', variants: [v('PA-1')] });
    const d = await service.getProduct('shirt', 'pt');
    expect(d.name).toBe('Shirt');
    expect(d.slug).toBe('shirt');
    expect(d.description).toBe('<p>d</p>');
    const d2 = await service.getProduct('pants', 'pt');
    expect(d2.name).toBe('Calças');
    expect(d2.slug).toBe('pants-pt');
    expect(d2.slugs).toEqual({ en: 'pants', pt: 'pants-pt' });
    const d3 = await service.getProduct('pants-pt', 'pt');
    expect(d3.name).toBe('Calças');
    await expect(service.getProduct('pants-pt', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    const list = await service.listProducts({ locale: 'pt', sort: 'name_asc' });
    expect(list.results.map((r) => r.name)).toEqual(['Calças', 'Shirt']);
  });

  it('images: variant gallery falls back to product; alt is the product name by locale', async () => {
    const { service, addProduct } = setup();
    addProduct({
      name: 'Pants',
      pt: 'Calças',
      images: ['/uploads/b.webp', '/uploads/a.webp'],
      variants: [v('P1'), v('P2', 1000, { images: ['/uploads/v.webp'] })],
    });
    addProduct({ name: 'Shirt', variants: [v('S1', 1000, { images: ['/uploads/sv.webp'] })] });
    const d = await service.getProduct('pants', 'pt');
    expect(d.images).toEqual([
      { url: '/uploads/b.webp', width: 10, height: 20, alt: 'Calças', cover: true },
      { url: '/uploads/a.webp', width: 10, height: 20, alt: 'Calças', cover: false },
    ]);
    expect(d.variants[0].images).toEqual(d.images);
    expect(d.variants[1].images).toEqual([{ url: '/uploads/v.webp', width: 1, height: 2, alt: 'Calças', cover: true }]);
    const list = await service.listProducts({ locale: 'pt', sort: 'name_asc' });
    expect(list.results[0].image).toEqual(d.images[0]);
    const shirt = list.results.find((r) => r.name === 'Shirt')!;
    expect(shirt.image).toEqual({ url: '/uploads/sv.webp', width: 1, height: 2, alt: 'Shirt', cover: true });
    expect(Object.keys(d.images[0]).sort()).toEqual(['alt', 'cover', 'height', 'url', 'width']);
  });

  it('images: the marked cover is flagged and shown in the list; the gallery keeps its order', async () => {
    const { service, addProduct, tables } = setup();
    addProduct({ name: 'Pants', images: ['/uploads/a.webp', '/uploads/b.webp', '/uploads/c.webp'], variants: [v('P1')] });
    tables[UIDS.image].find((i: any) => i.url === '/uploads/b.webp').cover = true;
    const d = await service.getProduct('pants', 'en');
    expect(d.images.map((i) => [i.url, i.cover])).toEqual([
      ['/uploads/a.webp', false],
      ['/uploads/b.webp', true],
      ['/uploads/c.webp', false],
    ]);
    const list = await service.listProducts({ locale: 'en' });
    expect(list.results[0].image?.url).toBe('/uploads/b.webp');
  });

  it('empty pt name falls back to en', async () => {
    const { service, addProduct, tables } = setup();
    addProduct({ name: 'Shirt', pt: 'x', variants: [v('SH-1')] });
    tables[UIDS.productTranslation].find((t) => t.locale === 'pt').name = '';
    expect((await service.getProduct('shirt', 'pt')).name).toBe('Shirt');
    expect((await service.listProducts({ locale: 'pt' })).results[0].name).toBe('Shirt');
  });

  it('search matches a name in another locale', async () => {
    const { service, addProduct } = setup();
    addProduct({ name: 'Pants', pt: 'Calças', variants: [v('PA-1')] });
    addProduct({ name: 'Shirt', variants: [v('SH-1')] });
    const res = await service.listProducts({ locale: 'en', search: 'calças' });
    expect(res.results.map((r) => r.name)).toEqual(['Pants']);
  });

  it('dedupes product rows repeated by joins', async () => {
    const { service, addProduct } = setup({ duplicateRows: true });
    addProduct({ name: 'A', variants: [v('A1'), v('A2')] });
    addProduct({ name: 'B', variants: [v('B1')] });
    const res = await service.listProducts({ locale: 'en' });
    expect(res.results.map((r) => r.name)).toEqual(['B', 'A']);
    expect(res.pagination.total).toBe(2);
  });

  describe('categories', () => {
    it('tree: active only, an inactive node hides its whole subtree, ordered by position, locale fallback', async () => {
      const { service, addCategory } = setup();
      const a = addCategory({ texts: { en: { name: 'Apparel', slug: 'apparel' }, pt: { name: 'Roupa', slug: 'roupa' } }, position: 1 });
      const a2 = addCategory({ texts: { en: { name: 'Hidden', slug: 'hidden' } }, parent: a, active: false, position: 0 });
      addCategory({ texts: { en: { name: 'Under hidden', slug: 'under-hidden' } }, parent: a2 });
      const a1 = addCategory({ texts: { en: { name: 'Shirts', slug: 'shirts' } }, parent: a, position: 2 });
      const off = addCategory({ texts: { en: { name: 'Off', slug: 'off' } }, active: false, position: 0 });
      addCategory({ texts: { en: { name: 'Under off', slug: 'under-off' } }, parent: off });
      const b = addCategory({ texts: { en: { name: 'Books', slug: 'books' } }, position: 0 });
      const tree = await service.listCategories('pt');
      expect(tree).toEqual([
        { id: b, name: 'Books', slug: 'books', parentId: null, position: 0, children: [] },
        {
          id: a,
          name: 'Roupa',
          slug: 'roupa',
          parentId: null,
          position: 1,
          children: [{ id: a1, name: 'Shirts', slug: 'shirts', parentId: a, position: 2, children: [] }],
        },
      ]);
    });

    it('Review Focus 5: a pt request with the en slug resolves (default-locale fallback)', async () => {
      const { service, addCategory, addProduct, organize } = setup();
      const root = addCategory({ texts: { en: { name: 'Shoes', slug: 'shoes' }, pt: { name: 'Sapatos', slug: 'sapatos' } } });
      const kid = addCategory({ texts: { en: { name: 'Boots', slug: 'boots' }, pt: { name: 'Botas', slug: 'botas' } }, parent: root });
      const c = await service.getCategory('boots', 'pt');
      expect(c).toMatchObject({
        id: kid,
        name: 'Botas',
        slug: 'botas',
        parentId: root,
        path: [
          { id: root, name: 'Sapatos', slug: 'sapatos' },
          { id: kid, name: 'Botas', slug: 'botas' },
        ],
      });
      expect(c).not.toHaveProperty('children');
      const p = addProduct({ name: 'Boot', variants: [v('B1')] });
      addProduct({ name: 'Other', variants: [v('O1')] });
      await organize(p, { category: kid });
      const list = await service.listProducts({ locale: 'pt', category: 'shoes' });
      expect(list.results.map((r) => r.id)).toEqual([p]);
      // The pt slug does not resolve in en.
      await expect(service.getCategory('botas', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    });

    it('Review Focus 5: an inactive ancestor (or itself) → 404, for the category and the product filter', async () => {
      const { service, addCategory, addProduct, organize } = setup();
      const root = addCategory({ texts: { en: { name: 'Root', slug: 'root' } }, active: false });
      const mid = addCategory({ texts: { en: { name: 'Mid', slug: 'mid' } }, parent: root });
      const leaf = addCategory({ texts: { en: { name: 'Leaf', slug: 'leaf' } }, parent: mid });
      const p = addProduct({ name: 'P', variants: [v('P1')] });
      await organize(p, { category: leaf });
      for (const slug of ['root', 'mid', 'leaf', 'unknown']) {
        await expect(service.getCategory(slug, 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
        await expect(service.listProducts({ locale: 'pt', category: slug })).rejects.toBeInstanceOf(
          EcommerceNotFoundError
        );
      }
      // The product stays reachable by other routes, without the hidden category.
      const detail = await service.getProduct('p', 'en');
      expect(detail.category).toBeNull();
    });

    it('category filter includes the whole subtree, any depth, whatever the subcategories activity', async () => {
      const { service, addCategory, addProduct, organize } = setup();
      const root = addCategory({ texts: { en: { name: 'Root', slug: 'root' } } });
      const off = addCategory({ texts: { en: { name: 'Off', slug: 'off' } }, parent: root, active: false });
      const deep = addCategory({ texts: { en: { name: 'Deep', slug: 'deep' } }, parent: off });
      const other = addCategory({ texts: { en: { name: 'Other', slug: 'other' } } });
      const a = addProduct({ name: 'A', variants: [v('A1')] });
      const b = addProduct({ name: 'B', variants: [v('B1')] });
      const c = addProduct({ name: 'C', variants: [v('C1')] });
      await organize(a, { category: root });
      await organize(b, { category: deep });
      await organize(c, { category: other });
      const res = await service.listProducts({ locale: 'en', category: 'root' });
      expect(res.results.map((r) => r.id)).toEqual([b, a]);
    });
  });

  describe('collections', () => {
    it('list: active only, by title in the locale, paginated; never conditions, match or type', async () => {
      const { service, addCollection } = setup();
      const sale = addCollection({ texts: { en: { title: 'Sale', slug: 'sale' }, pt: { title: 'Promoções', slug: 'promocoes' } } });
      const news = addCollection({ texts: { en: { title: 'New in', slug: 'new-in' } } });
      addCollection({ texts: { en: { title: 'Archive', slug: 'archive' } }, active: false });
      const all = await service.listCollections({ locale: 'pt' });
      expect(all.results.map((r) => r.id)).toEqual([news, sale]);
      expect(all.pagination).toEqual({ page: 1, pageSize: 24, total: 2, pageCount: 1 });
      expect(all.results[1]).toEqual({
        id: sale,
        title: 'Promoções',
        slug: 'promocoes',
        description: '',
        seoTitle: null,
        seoDescription: null,
      });
      const p2 = await service.listCollections({ locale: 'en', page: 2, pageSize: 1 });
      expect(p2.results.map((r) => r.id)).toEqual([sale]);
      expect(p2.pagination).toEqual({ page: 2, pageSize: 1, total: 2, pageCount: 2 });
      const json = JSON.stringify(all);
      expect(json).not.toContain('conditions');
      expect(json).not.toContain('secret-rule');
      expect(json).not.toContain('AUTOMATED');
      expect((await service.listCollections({ locale: 'en', pageSize: 51 }).catch((e: any) => e)).errors).toEqual([
        { path: 'pageSize', code: 'invalid_number' },
      ]);
    });

    it('by slug: request locale then default locale; inactive or unknown → 404; no conditions', async () => {
      const { service, addCollection } = setup();
      const id = addCollection({
        texts: {
          en: { title: 'Sale', slug: 'sale', description: 'Cheap', seoTitle: 'Sale!', seoDescription: 'All on sale' },
          pt: { title: 'Promoções', slug: 'promocoes' },
        },
      });
      addCollection({ texts: { en: { title: 'Off', slug: 'off' } }, active: false });
      const c = await service.getCollection('sale', 'pt');
      expect(c).toEqual({
        id,
        title: 'Promoções',
        slug: 'promocoes',
        description: 'Cheap',
        seoTitle: 'Sale!',
        seoDescription: 'All on sale',
      });
      expect(JSON.stringify(c)).not.toMatch(/conditions|match|secret-rule|AUTOMATED|sortOrder/);
      expect((await service.getCollection('promocoes', 'pt')).id).toBe(id);
      await expect(service.getCollection('promocoes', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
      await expect(service.getCollection('off', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
      await expect(service.getCollection('nope', 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
      await expect(service.listProducts({ locale: 'en', collection: 'off' })).rejects.toBeInstanceOf(
        EcommerceNotFoundError
      );
    });

    it('collection filter uses the collection sort (manual = member position) unless sort is given', async () => {
      const { service, addProduct, addCollection, sold } = setup();
      const a = addProduct({ name: 'A', variants: [v('A1', 300)] });
      const b = addProduct({ name: 'B', variants: [v('B1', 100)] });
      const c = addProduct({ name: 'C', variants: [v('C1', 200)] });
      addProduct({ name: 'Outside', variants: [v('O1')] });
      addCollection({ texts: { en: { title: 'Manual', slug: 'manual' } }, members: [b, a, c] });
      addCollection({ texts: { en: { title: 'Best', slug: 'best' } }, sortOrder: 'BEST_SELLING', members: [a, b, c] });
      addCollection({ texts: { en: { title: 'Cheap', slug: 'cheap' } }, sortOrder: 'PRICE_ASC', members: [a, b, c] });
      const ids = async (q: any) => (await service.listProducts({ locale: 'en', ...q })).results.map((r) => r.id);
      expect(await ids({ collection: 'manual' })).toEqual([b, a, c]);
      expect(await ids({ collection: 'manual', sort: 'name_desc' })).toEqual([c, b, a]);
      expect(await ids({ collection: 'cheap' })).toEqual([b, c, a]);
      sold.set(c, 5);
      sold.set(a, 2);
      expect(await ids({ collection: 'best' })).toEqual([c, a, b]);
      expect(await ids({ collection: 'best', sort: 'oldest' })).toEqual([a, b, c]);
    });
  });

  describe('product filters and sorts', () => {
    it('type and tag (any of), combined with AND', async () => {
      const { service, addProduct, addType, addTag, organize } = setup();
      const shirt = addType({ en: 'Shirt' });
      const mug = addType({ en: 'Mug' });
      const red = addTag({ en: 'Red' });
      const blue = addTag({ en: 'Blue' });
      const green = addTag({ en: 'Green' });
      const a = addProduct({ name: 'A', variants: [v('A1')] });
      const b = addProduct({ name: 'B', variants: [v('B1')] });
      const c = addProduct({ name: 'C', variants: [v('C1')] });
      await organize(a, { productType: shirt, tags: [red] });
      await organize(b, { productType: shirt, tags: [blue, green] });
      await organize(c, { productType: mug, tags: [red, blue] });
      const ids = async (q: any) => (await service.listProducts({ locale: 'en', ...q })).results.map((r) => r.id);
      expect(await ids({ type: String(shirt) })).toEqual([b, a]);
      expect(await ids({ tag: String(red) })).toEqual([c, a]);
      expect(await ids({ tag: `${red},${green}` })).toEqual([c, b, a]);
      expect(await ids({ type: String(shirt), tag: `${red},${green}` })).toEqual([b, a]);
      expect(await ids({ type: String(mug), tag: `${green}` })).toEqual([]);
      expect(await ids({ type: '999999' })).toEqual([]);
      expect(await ids({ tag: '999999' })).toEqual([]);
      const err = async (q: any) => (await service.listProducts({ locale: 'en', ...q }).catch((e: any) => e)).errors;
      expect(await err({ type: 'x' })).toEqual([{ path: 'type', code: 'invalid' }]);
      expect(await err({ type: '0' })).toEqual([{ path: 'type', code: 'invalid' }]);
      expect(await err({ tag: `${red},x` })).toEqual([{ path: 'tag', code: 'invalid' }]);
      expect(await err({ tag: `${red},,${blue}` })).toEqual([{ path: 'tag', code: 'invalid' }]);
      expect(await err({ category: ['a', 'b'] })).toEqual([{ path: 'category', code: 'invalid' }]);
    });

    it('sorts best_selling (ties by newest), oldest and name_desc', async () => {
      const { service, addProduct, sold } = setup();
      const a = addProduct({ name: 'Alpha', variants: [v('A1')] });
      const b = addProduct({ name: 'Bravo', variants: [v('B1')] });
      const c = addProduct({ name: 'Charlie', variants: [v('C1')] });
      const d = addProduct({ name: 'Delta', variants: [v('D1')] });
      sold.set(b, 4);
      sold.set(a, 1);
      const ids = async (sort: string) => (await service.listProducts({ locale: 'en', sort })).results.map((r) => r.id);
      expect(await ids('best_selling')).toEqual([b, a, d, c]);
      expect(await ids('oldest')).toEqual([a, b, c, d]);
      expect(await ids('name_desc')).toEqual([d, c, b, a]);
    });

    it('compareAtPrice only when above the price; category, type and tags on the answers', async () => {
      const { service, addProduct, addCategory, addType, addTag, organize } = setup();
      const root = addCategory({ texts: { en: { name: 'Home', slug: 'home' }, pt: { name: 'Casa', slug: 'casa' } } });
      const kid = addCategory({ texts: { en: { name: 'Mugs', slug: 'mugs' } }, parent: root });
      const type = addType({ en: 'Mug', pt: 'Caneca' });
      const red = addTag({ en: 'Red', pt: 'Vermelho' });
      const big = addTag({ en: 'Big' });
      const p = addProduct({
        name: 'Cup',
        variants: [
          v('C1', 1000, { compareAtPrice: 1500 }),
          v('C2', 800, { compareAtPrice: 800 }),
          v('C3', 900, { compareAtPrice: 1200 }),
          v('C4', 700, { compareAtPrice: 2000, active: false }),
        ],
      });
      const q = addProduct({ name: 'Plain', variants: [v('Q1', 500, { compareAtPrice: 900 }), v('Q2', 600)] });
      await organize(p, { category: kid, productType: type, tags: [red, big] });
      const list = await service.listProducts({ locale: 'pt', sort: 'name_asc' });
      const cup = list.results.find((r) => r.id === p)!;
      const plain = list.results.find((r) => r.id === q)!;
      // Lowest price C2 (800) has no compare-at above it.
      expect(cup.compareAtPriceMin).toBeNull();
      expect(plain.compareAtPriceMin).toBe(900);
      const category = {
        id: kid,
        name: 'Mugs',
        slug: 'mugs',
        path: [
          { id: root, name: 'Casa', slug: 'casa' },
          { id: kid, name: 'Mugs', slug: 'mugs' },
        ],
      };
      expect(cup).toMatchObject({
        category,
        productType: { id: type, name: 'Caneca' },
        tags: [
          { id: big, name: 'Big' },
          { id: red, name: 'Vermelho' },
        ],
      });
      expect(plain).toMatchObject({ category: null, productType: null, tags: [] });
      const detail = await service.getProduct('cup', 'pt');
      expect(detail.variants.map((x) => [x.sku, x.compareAtPrice])).toEqual([
        ['C1', 1500],
        ['C2', null],
        ['C3', 1200],
      ]);
      expect(detail).toMatchObject({
        category,
        productType: { id: type, name: 'Caneca' },
        tags: [
          { id: big, name: 'Big' },
          { id: red, name: 'Vermelho' },
        ],
      });
      expect(JSON.stringify([list, detail])).not.toMatch(/"key"|"active"|stock/);
    });
  });
});
