import { describe, it, expect, vi } from 'vitest';
import EcommerceCollectionService from '../../../server/src/services/modules/ecommerce/collections';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  image: `${P}image`,
  category: `${P}product-category`,
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
    collectionMembers: [UIDS.collectionProduct, 'product'],
  },
  [UIDS.variant]: { images: [UIDS.image, 'variant'] },
  [UIDS.collection]: {
    translations: [UIDS.collectionTranslation, 'collection'],
    members: [UIDS.collectionProduct, 'collection'],
  },
  [UIDS.collectionProduct]: {
    collection: [UIDS.collection, 'collection', 'manyToOne'],
    product: [UIDS.product, 'product', 'manyToOne'],
  },
  [UIDS.order]: { lines: [UIDS.orderLine, 'order'] },
  [UIDS.orderLine]: { order: [UIDS.order, 'order', 'manyToOne'] },
};

const NOW = new Date('2026-11-22T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, { enforceUnique: [UIDS.collectionProduct] });
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction, connection: db.connection, metadata: db.metadata },
    log: { warn: vi.fn() },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en', find: async () => [{ code: 'en' }] }) }
        : { service: () => undefined },
  };
  const service = EcommerceCollectionService({ strapi });
  const q = (uid: string) => db.query(uid);
  const product = async (name: string) => {
    const p = await q(UIDS.product).create({ data: { active: true } });
    await q(UIDS.productTranslation).create({ data: { product: p.id, locale: 'en', name, slug: name.toLowerCase() } });
    await q(UIDS.variant).create({ data: { product: p.id, sku: `${name}-1`, price: 1000, active: true, position: 0 } });
    return p.id as number;
  };
  const sale = async (
    lines: { productId: number; quantity: number; returnedQuantity?: number; isGift?: boolean }[],
    order: { orderStatus?: string; paymentStatus?: string; age?: number } = {}
  ) => {
    const o = await q(UIDS.order).create({
      data: {
        orderStatus: order.orderStatus ?? 'OPEN',
        paymentStatus: order.paymentStatus ?? 'PAID',
        createdAt: daysAgo(order.age ?? 1),
      },
    });
    for (const l of lines) await q(UIDS.orderLine).create({ data: { returnedQuantity: 0, isGift: false, ...l, order: o.id } });
  };
  return { service, q, product, sale };
}

describe('unitsSoldByProduct', () => {
  it('sums paid, open orders', async () => {
    const { service, product, sale } = setup();
    const a = await product('A');
    await sale([{ productId: a, quantity: 2 }]);
    await sale([{ productId: a, quantity: 3 }], { paymentStatus: 'PARTIALLY_REFUNDED', orderStatus: 'ARCHIVED' });
    expect((await service.unitsSoldByProduct([a], NOW)).get(a)).toBe(5);
  });

  it('ignores cancelled, unpaid and older than 90 days orders', async () => {
    const { service, product, sale } = setup();
    const a = await product('A');
    await sale([{ productId: a, quantity: 5 }], { orderStatus: 'CANCELLED' });
    await sale([{ productId: a, quantity: 5 }], { paymentStatus: 'PENDING' });
    await sale([{ productId: a, quantity: 5 }], { age: 91 });
    await sale([{ productId: a, quantity: 1 }], { age: 89 });
    expect((await service.unitsSoldByProduct([a], NOW)).get(a)).toBe(1);
  });

  it('subtracts returned units (floor 0) and skips gifts', async () => {
    const { service, product, sale } = setup();
    const a = await product('A');
    const b = await product('B');
    await sale([
      { productId: a, quantity: 4, returnedQuantity: 1 },
      { productId: a, quantity: 9, isGift: true },
      { productId: b, quantity: 1, returnedQuantity: 3 },
    ]);
    const m = await service.unitsSoldByProduct([a, b], NOW);
    expect(m.get(a)).toBe(3);
    expect(m.get(b) ?? 0).toBe(0);
  });

  it('only reports the requested products and handles none', async () => {
    const { service, product, sale } = setup();
    const a = await product('A');
    const b = await product('B');
    await sale([{ productId: a, quantity: 1 }, { productId: b, quantity: 2 }]);
    const m = await service.unitsSoldByProduct([a], NOW);
    expect(m.has(b)).toBe(false);
    expect((await service.unitsSoldByProduct([], NOW)).size).toBe(0);
  });

  it('orders a BEST_SELLING collection by units sold', async () => {
    const { service, product, sale } = setup();
    const a = await product('A');
    const b = await product('B');
    const c = await product('C');
    await sale([{ productId: b, quantity: 5 }, { productId: c, quantity: 2 }, { productId: a, quantity: 1 }]);
    const col: any = await service.create({
      type: 'MANUAL',
      active: true,
      image: null,
      sortOrder: 'BEST_SELLING',
      translations: { en: { title: 'Top' } },
    } as any);
    await service.addProducts(col.id, [a, b, c]);
    const res = await service.listProducts(col.id, { page: 1 });
    expect(res.results.map((r) => r.productId)).toEqual([b, c, a]);
  });
});
