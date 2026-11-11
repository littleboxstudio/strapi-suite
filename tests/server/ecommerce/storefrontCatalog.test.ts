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
};
const RELATIONS: FakeRelations = {
  [UIDS.product]: {
    translations: [UIDS.productTranslation, 'product'],
    variants: [UIDS.variant, 'product'],
    images: [UIDS.image, 'product'],
  },
  [UIDS.variant]: {
    translations: [UIDS.variantTranslation, 'variant'],
    images: [UIDS.image, 'variant'],
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
    plugin: () => ({
      service: () => ({
        getDefaultLocale: async () => 'en',
        find: async () => [{ code: 'en' }, { code: 'pt' }],
      }),
    }),
  };
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
  return { service, addProduct, tables };
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
      { url: '/uploads/b.webp', width: 10, height: 20, alt: 'Calças' },
      { url: '/uploads/a.webp', width: 10, height: 20, alt: 'Calças' },
    ]);
    expect(d.variants[0].images).toEqual(d.images);
    expect(d.variants[1].images).toEqual([{ url: '/uploads/v.webp', width: 1, height: 2, alt: 'Calças' }]);
    const list = await service.listProducts({ locale: 'pt', sort: 'name_asc' });
    expect(list.results[0].image).toEqual(d.images[0]);
    const shirt = list.results.find((r) => r.name === 'Shirt')!;
    expect(shirt.image).toEqual({ url: '/uploads/sv.webp', width: 1, height: 2, alt: 'Shirt' });
    expect(Object.keys(d.images[0]).sort()).toEqual(['alt', 'height', 'url', 'width']);
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
});
