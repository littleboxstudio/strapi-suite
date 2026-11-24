import { describe, it, expect, vi } from 'vitest';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceProductService from '../../../server/src/services/modules/ecommerce/products';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceOrganizationService from '../../../server/src/services/modules/ecommerce/organization';
import EcommerceCollectionService from '../../../server/src/services/modules/ecommerce/collections';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  variantTranslation: `${P}variant-translation`,
  image: `${P}image`,
  stockMovement: `${P}stock-movement`,
  order: `${P}order`,
  orderLine: `${P}order-line`,
  category: `${P}product-category`,
  categoryTranslation: `${P}product-category-translation`,
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
    tags: [UIDS.tag, 'product_tags', 'manyToMany'],
    collectionMembers: [UIDS.collectionProduct, 'product'],
  },
  [UIDS.variant]: {
    product: [UIDS.product, 'product', 'manyToOne'],
    translations: [UIDS.variantTranslation, 'variant'],
    images: [UIDS.image, 'variant'],
  },
  [UIDS.orderLine]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.category]: {
    parent: [UIDS.category, 'parent', 'manyToOne'],
    children: [UIDS.category, 'parent'],
    translations: [UIDS.categoryTranslation, 'category'],
    products: [UIDS.product, 'category'],
  },
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

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.stockMovement, UIDS.variant, UIDS.tag, UIDS.collectionProduct],
  });
  const services: Record<string, any> = {
    EcommerceImageService: { removeFiles: vi.fn(async () => undefined) },
  };
  const strapi: any = {
    db: {
      query: db.query,
      transaction: db.transaction,
      inTransaction: db.inTransaction,
      connection: db.connection,
      metadata: db.metadata,
    },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    log: { warn: vi.fn() },
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
        : { service: (name: string) => services[name] },
  };
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceOrganizationService = EcommerceOrganizationService({ strapi });
  services.EcommerceCollectionService = EcommerceCollectionService({ strapi });
  services.EcommerceProductService = EcommerceProductService({ strapi });
  const q = (uid: string) => db.query(uid);
  return {
    db,
    q,
    strapi,
    services,
    products: services.EcommerceProductService as ReturnType<typeof EcommerceProductService>,
    stock: () => services.EcommerceStockService as ReturnType<typeof EcommerceStockService>,
    organization: services.EcommerceOrganizationService as ReturnType<typeof EcommerceOrganizationService>,
    collections: services.EcommerceCollectionService as ReturnType<typeof EcommerceCollectionService>,
  };
}

type Setup = ReturnType<typeof setup>;

const variant = (sku: string, extra: any = {}) => ({
  sku,
  price: 900,
  tax: 23,
  stock: 0,
  weight: 1,
  width: 1,
  height: 1,
  depth: 1,
  active: true,
  translations: { en: { option: 'M' } },
  ...extra,
});

const productInput = (name: string, variants: any[], extra: any = {}) => ({
  active: true,
  translations: { en: { name, description: '<p>x</p>' } },
  variants,
  ...extra,
});

const automated = (title: string, conditions: any[], match = 'ALL') => ({
  type: 'AUTOMATED' as const,
  active: true,
  image: null,
  match: match as any,
  conditions,
  translations: { en: { title } },
});

const members = async (s: Setup, collectionId: number): Promise<number[]> =>
  (await s.q(UIDS.collectionProduct).findMany({ where: { collection: { id: collectionId } } }))
    .map((r: any) => r.product)
    .sort((a: number, b: number) => a - b);

const variantOf = async (s: Setup, productId: number) => (await s.products.get(productId)).variants[0];

describe('automated collections — kept up to date', () => {
  it('a product created under PRICE lt 1000 joins; raised to 1500 via update it leaves', async () => {
    const s = setup();
    const { id: collectionId } = await s.collections.create(
      automated('Cheap', [{ field: 'PRICE', operator: 'lt', value: 1000 }])
    );
    const { id } = await s.products.create(productInput('Shirt', [variant('S-1')]));
    expect(await members(s, collectionId)).toEqual([id]);
    const row = await s.q(UIDS.collectionProduct).findOne({ where: { collection: { id: collectionId } } });
    expect(row.uniqueKey).toBe(`${collectionId}:${id}`);

    const v = await variantOf(s, id);
    await s.products.update(id, productInput('Shirt', [variant('S-1', { id: v.id, price: 1500 })]));
    expect(await members(s, collectionId)).toEqual([]);
  });

  it('Review Focus 2: stock taken to 0 by an order deduction adds the product to an INVENTORY lte 0 collection', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Mug', [variant('M-1', { stock: 1 })]));
    const { id: collectionId } = await s.collections.create(
      automated('Sold out', [{ field: 'INVENTORY', operator: 'lte', value: 0 }])
    );
    expect(await members(s, collectionId)).toEqual([]);

    const v = await variantOf(s, id);
    const moved = await s.stock().move({
      variantId: v.id,
      quantity: -1,
      type: 'ORDER_DEDUCT',
      operationKey: 'order:1:deduct:1',
      orderId: 1,
      actor: 'system',
    });
    expect(moved).toEqual({ applied: true });
    expect(await members(s, collectionId)).toEqual([id]);

    await s.stock().move({
      variantId: v.id,
      quantity: 1,
      type: 'CANCEL_RESTOCK',
      operationKey: 'cancel:1:restock:1',
      orderId: 1,
      actor: 'system',
    });
    expect(await members(s, collectionId)).toEqual([]);
  });

  it('inside a caller transaction the sync waits for the commit (one sync per product), never during it', async () => {
    const s = setup();
    const { id } = await s.products.create(
      productInput('Mug', [variant('M-1', { stock: 1 }), variant('M-2', { stock: 1 })])
    );
    const { id: collectionId } = await s.collections.create(
      automated('Sold out', [{ field: 'INVENTORY', operator: 'lte', value: 0 }])
    );
    const [v1, v2] = (await s.products.get(id)).variants;
    const sync = vi.spyOn(s.collections, 'syncProducts');
    await s.strapi.db.transaction(async () => {
      for (const [i, v] of [v1, v2].entries()) {
        await s.stock().move({
          variantId: v.id,
          quantity: -1,
          type: 'ORDER_DEDUCT',
          operationKey: `order:3:deduct:${i}`,
          orderId: 3,
          actor: 'system',
          requireStock: true,
        });
      }
      expect(sync).not.toHaveBeenCalled();
      expect(await members(s, collectionId)).toEqual([]);
    });
    await vi.waitFor(async () => expect(await members(s, collectionId)).toEqual([id]));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith([id]);
  });

  it('a rolled-back caller transaction schedules no sync', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Mug', [variant('M-1', { stock: 1 })]));
    await s.collections.create(automated('Sold out', [{ field: 'INVENTORY', operator: 'lte', value: 0 }]));
    const v = await variantOf(s, id);
    const sync = vi.spyOn(s.collections, 'syncProducts');
    await expect(
      s.strapi.db.transaction(async () => {
        await s.stock().move({
          variantId: v.id,
          quantity: -1,
          type: 'ORDER_DEDUCT',
          operationKey: 'order:4:deduct:1',
          orderId: 4,
          actor: 'system',
        });
        throw new Error('order failed');
      })
    ).rejects.toThrow('order failed');
    await new Promise((r) => setTimeout(r, 0));
    expect(sync).not.toHaveBeenCalled();
    expect((await s.q(UIDS.variant).findOne({ where: { id: v.id } })).stock).toBe(1);
  });

  it('a product save with a stock adjustment syncs once, after its commit', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Mug', [variant('M-1', { stock: 1 })]));
    const v = await variantOf(s, id);
    const sync = vi.spyOn(s.collections, 'syncProducts');
    await s.products.update(
      id,
      productInput('Mug', [variant('M-1', { id: v.id, stock: 1, stockAdjustment: -1, stockAdjustmentKey: 'k1', stockExpected: 1 })])
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith([id]);
  });

  it('a collection sync failure after a stock move is logged by name and never undoes the move', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Mug', [variant('M-1', { stock: 1 })]));
    const v = await variantOf(s, id);
    s.services.EcommerceCollectionService = {
      syncProducts: vi.fn().mockRejectedValue(Object.assign(new Error('secret@example.com'), { name: 'SyncError' })),
    };
    const moved = await s.stock().move({
      variantId: v.id,
      quantity: -1,
      type: 'ORDER_DEDUCT',
      operationKey: 'order:2:deduct:1',
      orderId: 2,
      actor: 'system',
    });
    expect(moved).toEqual({ applied: true });
    expect(s.services.EcommerceCollectionService.syncProducts).toHaveBeenCalledWith([id]);
    expect((await s.q(UIDS.variant).findOne({ where: { id: v.id } })).stock).toBe(0);
    expect(s.strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('SyncError'));
    expect(s.strapi.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret@example.com'));
  });

  it('a tag added via update joins a TAG eq collection', async () => {
    const s = setup();
    const [summer] = await s.organization.ensureTags(['Summer']);
    const { id: collectionId } = await s.collections.create(
      automated('Summer', [{ field: 'TAG', operator: 'eq', value: summer }])
    );
    const { id } = await s.products.create(productInput('Hat', [variant('H-1')]));
    expect(await members(s, collectionId)).toEqual([]);
    const v = await variantOf(s, id);
    await s.products.update(id, productInput('Hat', [variant('H-1', { id: v.id })], { tagIds: [summer] }));
    expect(await members(s, collectionId)).toEqual([id]);
  });

  it('a deactivated product (or one whose only variant is deactivated) is removed', async () => {
    const s = setup();
    const { id: collectionId } = await s.collections.create(
      automated('Cheap', [{ field: 'PRICE', operator: 'lt', value: 1000 }])
    );
    const { id } = await s.products.create(productInput('Shirt', [variant('S-1')]));
    expect(await members(s, collectionId)).toEqual([id]);
    await s.products.setActive(id, false);
    expect(await members(s, collectionId)).toEqual([]);
    await s.products.setActive(id, true);
    expect(await members(s, collectionId)).toEqual([id]);
    await s.products.setVariantActive((await variantOf(s, id)).id, false);
    expect(await members(s, collectionId)).toEqual([]);
  });

  it('a deleted product leaves its automated collections', async () => {
    const s = setup();
    const { id: collectionId } = await s.collections.create(
      automated('Cheap', [{ field: 'PRICE', operator: 'lt', value: 1000 }])
    );
    const { id } = await s.products.create(productInput('Shirt', [variant('S-1')]));
    expect(await members(s, collectionId)).toEqual([id]);
    await s.products.delete(id);
    expect(await members(s, collectionId)).toEqual([]);
  });

  it('changed conditions swap the members; recalculate twice reports nothing the second time', async () => {
    const s = setup();
    const { id: cheap } = await s.products.create(productInput('Cheap', [variant('C-1', { price: 500 })]));
    const { id: dear } = await s.products.create(productInput('Dear', [variant('D-1', { price: 5000 })]));
    const { id: collectionId } = await s.collections.create(
      automated('Cheap', [{ field: 'PRICE', operator: 'lt', value: 1000 }])
    );
    expect(await members(s, collectionId)).toEqual([cheap]);

    await s.collections.update(collectionId, automated('Cheap', [{ field: 'PRICE', operator: 'gte', value: 1000 }]));
    expect(await members(s, collectionId)).toEqual([dear]);

    // Out-of-band drift is repaired by Recalculate.
    await s.q(UIDS.collectionProduct).deleteMany({ where: { collection: { id: collectionId } } });
    expect(await s.collections.recalculate(collectionId)).toEqual({ added: 1, removed: 0 });
    expect(await s.collections.recalculate(collectionId)).toEqual({ added: 0, removed: 0 });
    expect(await members(s, collectionId)).toEqual([dear]);
  });

  it('recalculate walks the whole catalogue in batches of 200', async () => {
    const s = setup();
    const ids: number[] = [];
    for (let i = 0; i < 205; i += 1) {
      const p = await s.q(UIDS.product).create({ data: { active: true } });
      await s.q(UIDS.productTranslation).create({ data: { product: p.id, locale: 'en', name: `P${i}`, slug: `p${i}` } });
      await s.q(UIDS.variant).create({ data: { product: p.id, sku: `P${i}`, price: 100, stock: 0, active: true } });
      ids.push(p.id);
    }
    const c = await s.q(UIDS.collection).create({
      data: { type: 'AUTOMATED', match: 'ALL', sortOrder: 'NEWEST', active: true, conditions: [{ field: 'PRICE', operator: 'lt', value: 1000 }] },
    });
    expect(await s.collections.recalculate(c.id)).toEqual({ added: 205, removed: 0 });
    expect(await members(s, c.id)).toEqual(ids);
  });

  it('recalculate leaves a manual collection alone', async () => {
    const s = setup();
    const { id } = await s.collections.create({
      type: 'MANUAL',
      active: true,
      image: null,
      translations: { en: { title: 'Picks' } },
    } as any);
    expect(await s.collections.recalculate(id)).toEqual({ added: 0, removed: 0 });
  });

  it('a stored rule with a field no longer offered evaluates as no conditions, without failing', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Shirt', [variant('S-1')]));
    const c = await s.q(UIDS.collection).create({
      data: {
        type: 'AUTOMATED',
        match: 'ALL',
        sortOrder: 'NEWEST',
        active: true,
        conditions: [
          { field: 'PRICE', operator: 'lt', value: 1000 },
          { field: 'BRAND', operator: 'eq', value: 'Acme' },
        ],
      },
    });
    await s.q(UIDS.collectionProduct).create({ data: { collection: c.id, product: id, position: 0 } });
    expect(await s.collections.recalculate(c.id)).toEqual({ added: 0, removed: 1 });
    await s.collections.syncProducts([id]);
    const v = await variantOf(s, id);
    await s.products.update(id, productInput('Shirt', [variant('S-1', { id: v.id })]));
    expect(await members(s, c.id)).toEqual([]);
    expect((await s.collections.get(c.id)).conditions).toEqual([{ field: 'PRICE', operator: 'lt', value: 1000 }]);
  });

  it('a category moved under the condition category joins via recalculateWhere (sub-subcategories included)', async () => {
    const s = setup();
    const { id: clothing } = await s.organization.createCategory({
      parentId: null,
      active: true,
      image: null,
      translations: { en: { name: 'Clothing' } },
    } as any);
    const { id: other } = await s.organization.createCategory({
      parentId: null,
      active: true,
      image: null,
      translations: { en: { name: 'Other' } },
    } as any);
    const { id: shirts } = await s.organization.createCategory({
      parentId: other,
      active: true,
      image: null,
      translations: { en: { name: 'Shirts' } },
    } as any);
    const { id: linen } = await s.organization.createCategory({
      parentId: shirts,
      active: true,
      image: null,
      translations: { en: { name: 'Linen' } },
    } as any);
    const { id } = await s.products.create(productInput('Linen shirt', [variant('L-1')], { categoryId: linen }));
    const { id: collectionId } = await s.collections.create(
      automated('Clothing', [{ field: 'CATEGORY', operator: 'eq', value: clothing }])
    );
    expect(await members(s, collectionId)).toEqual([]);

    await s.organization.updateCategory(shirts, {
      parentId: clothing,
      active: true,
      image: null,
      translations: { en: { name: 'Shirts' } },
    } as any);
    expect(await members(s, collectionId)).toEqual([id]);
  });

  it('preview returns the matches, newest first, without writing anything', async () => {
    const s = setup();
    const { id: a } = await s.products.create(productInput('Alpha', [variant('A-1', { price: 500 })]));
    await s.products.create(productInput('Beta', [variant('B-1', { price: 5000 })]));
    const { id: c } = await s.products.create(productInput('Gamma', [variant('G-1', { price: 700 })]));
    const before = s.db.tables[UIDS.collectionProduct].length;
    const collectionsBefore = s.db.tables[UIDS.collection].length;
    const out = await s.collections.preview({
      match: 'ALL',
      conditions: [{ field: 'PRICE', operator: 'lt', value: 1000 }],
      page: 1,
      locale: 'en',
    });
    expect(out.results).toEqual([
      { productId: c, name: 'Gamma', thumbnailUrl: null },
      { productId: a, name: 'Alpha', thumbnailUrl: null },
    ]);
    expect(out.pagination).toEqual({ page: 1, pageSize: 50, total: 2, pageCount: 1 });
    expect(s.db.tables[UIDS.collectionProduct].length).toBe(before);
    expect(s.db.tables[UIDS.collection].length).toBe(collectionsBefore);
  });

  it('preview refuses invalid or empty conditions', async () => {
    const s = setup();
    const errorsOf = async (p: Promise<unknown>) => {
      const err: any = await p.catch((e) => e);
      expect(err).toBeInstanceOf(EcommerceValidationError);
      return err.errors;
    };
    expect(await errorsOf(s.collections.preview({ match: 'ALL', conditions: [], page: 1, locale: 'en' }))).toEqual([
      { path: 'conditions', code: 'required' },
    ]);
    expect(
      await errorsOf(
        s.collections.preview({ match: 'ALL', conditions: [{ field: 'NOPE', operator: 'eq', value: 1 }], page: 1, locale: 'en' })
      )
    ).toEqual([{ path: 'conditions.0.field', code: 'invalid_field' }]);
  });

  it('syncProducts is idempotent and leaves manual memberships alone', async () => {
    const s = setup();
    const { id } = await s.products.create(productInput('Shirt', [variant('S-1')]));
    const { id: manualId } = await s.collections.create({
      type: 'MANUAL',
      active: true,
      image: null,
      translations: { en: { title: 'Picks' } },
    } as any);
    await s.collections.addProducts(manualId, [id]);
    const { id: autoId } = await s.collections.create(
      automated('Cheap', [{ field: 'PRICE', operator: 'lt', value: 1000 }])
    );
    await s.collections.syncProducts([id]);
    await s.collections.syncProducts([id]);
    expect(await members(s, autoId)).toEqual([id]);
    expect(await members(s, manualId)).toEqual([id]);
    await s.products.setActive(id, false);
    expect(await members(s, autoId)).toEqual([]);
    expect(await members(s, manualId)).toEqual([id]);
  });
});
