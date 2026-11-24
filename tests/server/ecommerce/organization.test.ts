import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceOrganizationService from '../../../server/src/services/modules/ecommerce/organization';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  category: `${P}product-category`,
  categoryTranslation: `${P}product-category-translation`,
  productType: `${P}product-type`,
  productTypeTranslation: `${P}product-type-translation`,
  tag: `${P}product-tag`,
  tagTranslation: `${P}product-tag-translation`,
  collection: `${P}collection`,
  collectionTranslation: `${P}collection-translation`,
};

const RELATIONS: FakeRelations = {
  [UIDS.product]: {
    translations: [UIDS.productTranslation, 'product'],
    category: [UIDS.category, 'category', 'manyToOne'],
    productType: [UIDS.productType, 'productType', 'manyToOne'],
    tags: [UIDS.tag, 'product_tags', 'manyToMany'],
  },
  [UIDS.category]: {
    parent: [UIDS.category, 'parent', 'manyToOne'],
    children: [UIDS.category, 'parent'],
    translations: [UIDS.categoryTranslation, 'category'],
    products: [UIDS.product, 'category'],
  },
  [UIDS.productType]: {
    translations: [UIDS.productTypeTranslation, 'productType'],
    products: [UIDS.product, 'productType'],
  },
  [UIDS.tag]: {
    translations: [UIDS.tagTranslation, 'tag'],
    products: [UIDS.product, 'product_tags', 'manyToMany'],
  },
  [UIDS.collection]: { translations: [UIDS.collectionTranslation, 'collection'] },
};

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.productType, UIDS.tag],
  });
  const recalculateWhere = vi.fn(async () => undefined);
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
        : { service: (name: string) => (name === 'EcommerceCollectionService' ? { recalculateWhere } : undefined) },
  };
  return { service: EcommerceOrganizationService({ strapi }), db, recalculateWhere };
}

const cat = (name: string, parentId: number | null = null, extra: any = {}) => ({
  parentId,
  active: true,
  image: null,
  translations: { en: { name } },
  ...extra,
});

const expectIssue = async (p: Promise<unknown>, path: string, code: string) => {
  const err: any = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(EcommerceValidationError);
  expect(err.errors).toContainEqual(expect.objectContaining({ path, code }));
  return err;
};

/** Creates a chain root > c2 > ... of `depth` levels; returns the ids from the root down. */
const chain = async (service: any, depth: number) => {
  const ids: number[] = [];
  for (let i = 0; i < depth; i += 1) {
    const { id } = await service.createCategory(cat(`Level ${i + 1}`, ids[i - 1] ?? null));
    ids.push(id);
  }
  return ids;
};

const addProduct = async (db: any, data: any = {}) => db.query(UIDS.product).create({ data: { active: true, ...data } });

const addAutomatedCollection = async (db: any, title: string, conditions: any[]) => {
  const c = await db.query(UIDS.collection).create({
    data: { type: 'AUTOMATED', match: 'ALL', sortOrder: 'NEWEST', active: true, conditions },
  });
  await db.query(UIDS.collectionTranslation).create({
    data: { collection: c.id, locale: 'en', title, handle: title.toLowerCase() },
  });
  return c;
};

describe('EcommerceOrganizationService — categories', () => {
  it('builds the tree in position order with names, slugs and product counts', async () => {
    const { service, db } = setup();
    const clothing = await service.createCategory(cat('Clothing', null, { translations: { en: { name: 'Clothing' }, pt: { name: 'Roupa' } } }));
    const shirts = await service.createCategory(cat('Shirts', clothing.id));
    const pants = await service.createCategory(cat('Pants', clothing.id));
    const shoes = await service.createCategory(cat('Shoes'));
    await addProduct(db, { category: shirts.id });
    await addProduct(db, { category: shirts.id });
    await addProduct(db, { category: clothing.id });
    await addProduct(db);

    const tree = await service.listCategoryTree('pt');
    expect(tree.map((n: any) => n.id)).toEqual([clothing.id, shoes.id]);
    expect(tree[0]).toMatchObject({ name: 'Roupa', slug: 'roupa', parentId: null, position: 0, productCount: 1, active: true });
    expect(tree[0].children.map((n: any) => [n.name, n.slug, n.position, n.productCount])).toEqual([
      ['Shirts', 'shirts', 0, 2],
      ['Pants', 'pants', 1, 0],
    ]);
    expect(tree[0].children[0].parentId).toBe(clothing.id);
    expect(tree[1]).toMatchObject({ name: 'Shoes', position: 1, children: [] });
    expect(pants.id).toBeGreaterThan(0);
  });

  it('requires the default-locale name', async () => {
    const { service } = setup();
    await expectIssue(service.createCategory(cat('  ')), 'translations.en.name', 'required');
  });

  it('generates unique slugs per locale and keeps them stable on rename', async () => {
    const { service } = setup();
    const a = await service.createCategory(cat('Linen'));
    const b = await service.createCategory(cat('Linen'));
    expect((await service.getCategory(b.id)).translations.en.slug).toBe('linen-2');
    await service.updateCategory(a.id, cat('Linen shirts'));
    const detail = await service.getCategory(a.id);
    expect(detail.translations.en).toMatchObject({ name: 'Linen shirts', slug: 'linen' });
  });

  it('adds -2, -3, … to an explicit slug taken by another category in the same locale', async () => {
    const { service } = setup();
    await service.createCategory(cat('Linen'));
    const b = await service.createCategory(
      cat('Other', null, { translations: { en: { name: 'Other', slug: 'linen' } } })
    );
    expect((await service.getCategory(b.id)).translations.en.slug).toBe('linen-2');
    const c = await service.createCategory(
      cat('Third', null, { translations: { en: { name: 'Third', slug: 'linen' } } })
    );
    expect((await service.getCategory(c.id)).translations.en.slug).toBe('linen-3');
    // Its own slug is not "taken": saving it unchanged keeps it.
    await service.updateCategory(b.id, cat('Other', null, { translations: { en: { name: 'Other', slug: 'linen-2' } } }));
    expect((await service.getCategory(b.id)).translations.en.slug).toBe('linen-2');
  });

  it('refuses an unknown parent', async () => {
    const { service } = setup();
    await expectIssue(service.createCategory(cat('A', 999)), 'parentId', 'unknown');
  });

  it('enforces the depth limit on create', async () => {
    const { service } = setup();
    const ids = await chain(service, 5);
    await expectIssue(service.createCategory(cat('Sixth', ids[4])), 'parentId', 'CATEGORY_TOO_DEEP');
  });

  it('enforces the depth limit on move (subtree height counts)', async () => {
    const { service } = setup();
    const ids = await chain(service, 4);
    const other = await service.createCategory(cat('Other'));
    await service.createCategory(cat('Other child', other.id));
    // Other (height 2) under level 4 => depth 6.
    await expectIssue(service.moveCategory(other.id, { parentId: ids[3], position: 0 }), 'parentId', 'CATEGORY_TOO_DEEP');
    // Under level 3 => depth 5: allowed.
    await service.moveCategory(other.id, { parentId: ids[2], position: 0 });
    expect((await service.getCategory(other.id)).parentId).toBe(ids[2]);
  });

  it('refuses a cycle on move', async () => {
    const { service } = setup();
    const ids = await chain(service, 3);
    await expectIssue(service.moveCategory(ids[0], { parentId: ids[2], position: 0 }), 'parentId', 'CATEGORY_CYCLE');
    await expectIssue(service.moveCategory(ids[0], { parentId: ids[0], position: 0 }), 'parentId', 'CATEGORY_CYCLE');
  });

  it('renumbers siblings on move and recalculates category conditions', async () => {
    const { service, recalculateWhere } = setup();
    const a = await service.createCategory(cat('A'));
    const b = await service.createCategory(cat('B'));
    const c = await service.createCategory(cat('C'));
    const x = await service.createCategory(cat('X', a.id));

    await service.moveCategory(c.id, { parentId: null, position: 0 });
    let tree = await service.listCategoryTree();
    expect(tree.map((n: any) => [n.name, n.position])).toEqual([['C', 0], ['A', 1], ['B', 2]]);

    await service.moveCategory(x.id, { parentId: null, position: 1 });
    tree = await service.listCategoryTree();
    expect(tree.map((n: any) => [n.name, n.position])).toEqual([['C', 0], ['X', 1], ['A', 2], ['B', 3]]);
    expect(tree.find((n: any) => n.name === 'A').children).toEqual([]);

    // Out of range positions are clamped.
    await service.moveCategory(c.id, { parentId: a.id, position: 99 });
    tree = await service.listCategoryTree();
    expect(tree.map((n: any) => [n.name, n.position])).toEqual([['X', 0], ['A', 1], ['B', 2]]);
    expect(tree[1].children.map((n: any) => [n.name, n.position])).toEqual([['C', 0]]);

    expect(recalculateWhere).toHaveBeenCalledWith({ categoryConditions: true });
    expect(b.id).toBeGreaterThan(0);
  });

  it('validates the move body', async () => {
    const { service } = setup();
    const a = await service.createCategory(cat('A'));
    await expectIssue(service.moveCategory(a.id, { parentId: null, position: -1 } as any), 'position', 'invalid_number');
    await expect(service.moveCategory(999, { parentId: null, position: 0 })).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('refuses to delete a category with subcategories', async () => {
    const { service } = setup();
    const a = await service.createCategory(cat('A'));
    await service.createCategory(cat('B', a.id));
    await expectIssue(service.deleteCategory(a.id), 'children', 'CATEGORY_HAS_CHILDREN');
  });

  it('deletes a category and keeps its products, without category', async () => {
    const { service, db } = setup();
    const a = await service.createCategory(cat('A'));
    const b = await service.createCategory(cat('B'));
    const p = await addProduct(db, { category: a.id });
    await service.deleteCategory(a.id);
    expect(db.tables[UIDS.product]).toHaveLength(1);
    expect(db.tables[UIDS.product][0].category ?? null).toBeNull();
    expect(db.tables[UIDS.categoryTranslation].some((t: any) => t.category === a.id)).toBe(false);
    const tree = await service.listCategoryTree();
    expect(tree.map((n: any) => [n.id, n.position])).toEqual([[b.id, 0]]);
    expect(p.id).toBeGreaterThan(0);
  });

  it('refuses to delete a category used by an automated collection, listing the collections', async () => {
    const { service, db } = setup();
    const a = await service.createCategory(cat('A'));
    await addAutomatedCollection(db, 'Summer', [{ field: 'CATEGORY', operator: 'neq', value: a.id }]);
    const err = await expectIssue(service.deleteCategory(a.id), 'collections', 'IN_USE_BY_COLLECTIONS');
    expect(err.errors.map((e: any) => e.detail)).toEqual(['Summer']);
    expect(db.tables[UIDS.category]).toHaveLength(1);
  });

  it('deleting a leaf with products recalculates category conditions (its ancestor may be referenced)', async () => {
    const { service, db, recalculateWhere } = setup();
    const parent = await service.createCategory(cat('Clothing'));
    const leaf = await service.createCategory(cat('Shirts', parent.id));
    await addAutomatedCollection(db, 'Clothing', [{ field: 'CATEGORY', operator: 'eq', value: parent.id }]);
    await addProduct(db, { category: leaf.id });
    await service.deleteCategory(leaf.id);
    expect(recalculateWhere).toHaveBeenCalledTimes(1);
    expect(recalculateWhere).toHaveBeenCalledWith({ categoryConditions: true });
  });

  it('deleting a category without products does not recalculate', async () => {
    const { service, recalculateWhere } = setup();
    const a = await service.createCategory(cat('A'));
    await service.deleteCategory(a.id);
    expect(recalculateWhere).not.toHaveBeenCalled();
  });

  it('deleting an unknown category is not found', async () => {
    const { service } = setup();
    await expect(service.deleteCategory(1)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('update can change the parent, placing it last among the new siblings', async () => {
    const { service, recalculateWhere } = setup();
    const a = await service.createCategory(cat('A'));
    await service.createCategory(cat('A1', a.id));
    const b = await service.createCategory(cat('B'));
    await service.updateCategory(b.id, cat('B', a.id));
    const tree = await service.listCategoryTree();
    expect(tree.map((n: any) => n.name)).toEqual(['A']);
    expect(tree[0].children.map((n: any) => [n.name, n.position])).toEqual([['A1', 0], ['B', 1]]);
    expect(recalculateWhere).toHaveBeenCalled();
  });
});

describe('EcommerceOrganizationService — product types and tags', () => {
  it('ensureProductType reuses a type whose name differs only in case or spaces', async () => {
    const { service, db } = setup();
    const first = await service.ensureProductType('Shirt');
    const again = await service.ensureProductType('  shirt ');
    expect(again).toBe(first);
    expect(db.tables[UIDS.productType]).toHaveLength(1);
    expect(db.tables[UIDS.productTypeTranslation][0]).toMatchObject({ locale: 'en', name: 'Shirt' });
  });

  it('creating a type with a taken name is refused', async () => {
    const { service } = setup();
    await service.createProductType({ translations: { en: { name: 'Shirt' } } });
    await expectIssue(service.createProductType({ translations: { en: { name: ' SHIRT' } } }), 'translations.en.name', 'NAME_TAKEN');
  });

  it('renaming a tag to a name differing only in case or spaces is refused (Review Focus 4)', async () => {
    const { service } = setup();
    await service.createTag({ translations: { en: { name: 'sale' } } });
    const other = await service.createTag({ translations: { en: { name: 'New' } } });
    await expectIssue(service.updateTag(other.id, { translations: { en: { name: 'SALE ' } } }), 'translations.en.name', 'NAME_TAKEN');
    // Renaming a tag to its own name in another case is fine.
    await service.updateTag(other.id, { translations: { en: { name: 'NEW' }, pt: { name: 'Novo' } } });
    const { results } = await service.listTags({ page: 1, locale: 'pt' });
    expect(results.find((t: any) => t.id === other.id)).toMatchObject({ name: 'Novo', translations: { en: { name: 'NEW' }, pt: { name: 'Novo' } } });
  });

  it('renaming a type into another type name is refused', async () => {
    const { service } = setup();
    await service.createProductType({ translations: { en: { name: 'Gift card' } } });
    const t = await service.createProductType({ translations: { en: { name: 'Shirt' } } });
    await expectIssue(service.updateProductType(t.id, { translations: { en: { name: 'gift   CARD' } } }), 'translations.en.name', 'NAME_TAKEN');
  });

  it('ensureTags dedupes, skips blanks and returns ids in order', async () => {
    const { service, db } = setup();
    const existing = await service.createTag({ translations: { en: { name: 'Sale' } } });
    const ids = await service.ensureTags(['new', ' SALE', 'New ', '  ']);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(existing.id);
    expect(db.tables[UIDS.tag]).toHaveLength(2);
  });

  it('lists types with search, pagination and product counts', async () => {
    const { service, db } = setup();
    const shirt = await service.ensureProductType('Shirt');
    await service.ensureProductType('Gift card');
    await addProduct(db, { productType: shirt });
    await addProduct(db, { productType: shirt });
    const all = await service.listProductTypes({ page: 1 });
    expect(all.pagination).toEqual({ page: 1, pageSize: 50, total: 2, pageCount: 1 });
    const found = await service.listProductTypes({ page: 1, search: 'shi' });
    expect(found.results).toEqual([
      expect.objectContaining({ id: shirt, name: 'Shirt', productCount: 2 }),
    ]);
  });

  it('deleting a tag removes it from products, which remain', async () => {
    const { service, db } = setup();
    const sale = await service.createTag({ translations: { en: { name: 'Sale' } } });
    const fresh = await service.createTag({ translations: { en: { name: 'New' } } });
    const p = await addProduct(db, { tags: { connect: [sale.id, fresh.id] } });
    await service.deleteTag(sale.id);
    expect(db.tables[UIDS.product]).toHaveLength(1);
    const row = await db.query(UIDS.product).findOne({ where: { id: p.id }, populate: { tags: true } });
    expect(row.tags.map((t: any) => t.id)).toEqual([fresh.id]);
    expect(db.tables[UIDS.tagTranslation].some((t: any) => t.tag === sale.id)).toBe(false);
  });

  it('deleting a type clears it on products, which remain', async () => {
    const { service, db } = setup();
    const shirt = await service.ensureProductType('Shirt');
    await addProduct(db, { productType: shirt });
    await service.deleteProductType(shirt);
    expect(db.tables[UIDS.product]).toHaveLength(1);
    expect(db.tables[UIDS.product][0].productType ?? null).toBeNull();
    expect(db.tables[UIDS.productType]).toHaveLength(0);
  });

  it('refuses to delete a type or tag used by an automated collection', async () => {
    const { service, db } = setup();
    const shirt = await service.ensureProductType('Shirt');
    const [sale] = await service.ensureTags(['Sale']);
    await addAutomatedCollection(db, 'Shirts', [{ field: 'PRODUCT_TYPE', operator: 'eq', value: shirt }]);
    await addAutomatedCollection(db, 'Deals', [{ field: 'TAG', operator: 'eq', value: String(sale) }]);
    await expectIssue(service.deleteProductType(shirt), 'collections', 'IN_USE_BY_COLLECTIONS');
    const err = await expectIssue(service.deleteTag(sale), 'collections', 'IN_USE_BY_COLLECTIONS');
    expect(err.errors.map((e: any) => e.detail)).toEqual(['Deals']);
  });

  it('a manual collection never blocks a delete', async () => {
    const { service, db } = setup();
    const [sale] = await service.ensureTags(['Sale']);
    await db.query(UIDS.collection).create({
      data: { type: 'MANUAL', match: 'ALL', sortOrder: 'MANUAL', active: true, conditions: [{ field: 'TAG', operator: 'eq', value: sale }] },
    });
    await service.deleteTag(sale);
    expect(db.tables[UIDS.tag]).toHaveLength(0);
  });

  it('unknown ids are not found', async () => {
    const { service } = setup();
    await expect(service.updateTag(5, { translations: { en: { name: 'X' } } })).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.deleteProductType(5)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });
});
