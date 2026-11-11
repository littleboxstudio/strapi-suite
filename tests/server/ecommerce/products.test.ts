import { describe, it, expect, vi } from 'vitest';
import { EcommerceValidationError, EcommerceNotFoundError } from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceProductService from '../../../server/src/services/modules/ecommerce/products';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
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
};

// relation name -> [target uid, foreign key on target]
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
  [UIDS.orderLine]: { order: [UIDS.order, 'order', 'manyToOne'] },
};

function makeStrapi() {
  const { tables, query, transaction, connection, metadata } = createFakeDb(
    Object.values(UIDS),
    RELATIONS,
    { enforceUnique: [UIDS.stockMovement, UIDS.variant] }
  );

  const imageService = { remove: vi.fn(), removeFiles: vi.fn(async (_rows: any[]) => undefined) };
  let stockService: any;

  const strapi: any = {
    db: { query, transaction, connection, metadata },
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
        : {
            service: (name: string) =>
              name === 'EcommerceStockService' ? stockService : imageService,
          },
  };
  stockService = EcommerceStockService({ strapi });
  return { service: EcommerceProductService({ strapi }), tables, imageService, transaction };
}

const variant = (sku: string, extra: any = {}) => ({
  sku,
  price: 1000,
  tax: 23,
  stock: 5,
  weight: 1,
  width: 1,
  height: 1,
  depth: 1,
  active: true,
  translations: { en: { option: 'M' } },
  ...extra,
});

const input = (name = 'Camisa', variants: any[] = [variant('CAM-P-M')], extra: any = {}) => ({
  active: true,
  translations: { en: { name, description: '<p>x</p>' } },
  variants,
  ...extra,
});

describe('EcommerceProductService', () => {
  it('list paginates 50 per page', async () => {
    const { service } = makeStrapi();
    for (let i = 0; i < 120; i += 1) await service.create(input(`P${i}`, [variant(`SKU-${i}`)]));
    const res = await service.list({ page: 2 });
    expect(res.results).toHaveLength(50);
    expect(res.pagination).toEqual({ page: 2, pageSize: 50, total: 120, pageCount: 3 });
    expect(res.results[0].id).toBeGreaterThan(res.results[49].id);
  });

  it('list searches by SKU', async () => {
    const { service, tables } = makeStrapi();
    await service.create(input('Camisa', [variant('CAM-P-M'), variant('CAM-P-L', { price: 2000 })]));
    tables[UIDS.variant][1].stock = -1; // negative stock comes from order flows, not the form
    await service.create(input('Calças', [variant('CAL-1')]));
    const res = await service.list({ page: 1, search: 'cam-p' });
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({
      name: 'Camisa',
      skus: ['CAM-P-M', 'CAM-P-L'],
      priceMin: 1000,
      priceMax: 2000,
      stockTotal: 4,
      variantCount: 2,
      hasNegativeStock: true,
      thumbnailUrl: null,
    });
  });

  it('list searches by name in any locale', async () => {
    const { service } = makeStrapi();
    await service.create(
      input('Camisa', [variant('A')], {
        translations: { en: { name: 'Shirt', description: '<p>x</p>' }, pt: { name: 'Camisola', description: '' } },
      })
    );
    expect((await service.list({ page: 1, search: 'camis' })).results).toHaveLength(1);
    expect((await service.list({ page: 1, locale: 'pt' })).results[0].name).toBe('Camisola');
  });

  it('generates unique slugs per locale', async () => {
    const { service, tables } = makeStrapi();
    await service.create(input('Camisa', [variant('A')]));
    await service.create(input('Camisa', [variant('B')]));
    expect(tables[UIDS.productTranslation].map((t) => t.slug)).toEqual(['camisa', 'camisa-2']);
  });

  it('falls back to "product" slug for non-latin names and keeps slug on update', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('日本', [variant('A')]));
    expect(tables[UIDS.productTranslation][0].slug).toBe('product');
    await service.update(id, input('日本', [variant('A')]));
    expect(tables[UIDS.productTranslation]).toHaveLength(1);
    expect(tables[UIDS.productTranslation][0].slug).toBe('product');
  });

  it('keeps the slug of an existing translation when the name changes', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Caneca', [variant('A')]));
    expect(tables[UIDS.productTranslation][0].slug).toBe('caneca');
    await service.update(id, input('Caneca Azul', [variant('A')]));
    expect(tables[UIDS.productTranslation]).toHaveLength(1);
    expect(tables[UIDS.productTranslation][0]).toMatchObject({ name: 'Caneca Azul', slug: 'caneca' });
  });

  it('generates the slug of a new translation and renews it after delete and recreate', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Caneca', [variant('A')]));
    const base = input('Caneca', [variant('A')]);
    await service.update(id, { ...base, translations: { ...base.translations, pt: { name: 'Chávena Grande', description: '' } } });
    const pt = () => tables[UIDS.productTranslation].find((t) => t.locale === 'pt');
    expect(pt()!.slug).toBe('chavena-grande');
    await service.update(id, { ...base, translations: { ...base.translations, pt: { name: '', description: '' } } });
    expect(pt()).toBeUndefined();
    await service.update(id, { ...base, translations: { ...base.translations, pt: { name: 'Taça', description: '' } } });
    expect(pt()!.slug).toBe('taca');
  });

  it('rejects a SKU used by another product and creates nothing', async () => {
    const { service, tables } = makeStrapi();
    await service.create(input('Camisa', [variant('DUP')]));
    const before = JSON.stringify(tables);
    const err: any = await service.create(input('Outra', [variant('OK'), variant('DUP')])).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'variants.1.sku', code: 'duplicate_sku' });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('returns validation errors from domain rules', async () => {
    const { service } = makeStrapi();
    const err: any = await service.create(input('', [])).catch((e) => e);
    expect(err.errors.map((e: any) => e.code)).toEqual(
      expect.arrayContaining(['required', 'min_variants'])
    );
  });

  it('update deletes omitted variants and their images', async () => {
    const { service, tables, imageService } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A'), variant('B')]));
    const detail = await service.get(id);
    const [a, b] = detail.variants;
    tables[UIDS.image].push(
      { id: 10, variant: b.id, position: 1, url: '/b1' },
      { id: 11, variant: b.id, position: 2, url: '/b2' },
      { id: 12, variant: a.id, position: 1, url: '/a1' }
    );
    await service.update(id, { ...input('Camisa', []), variants: [{ ...variant('A'), id: a.id }] });

    expect(imageService.remove).not.toHaveBeenCalled();
    expect(imageService.removeFiles).toHaveBeenCalledTimes(1);
    expect(imageService.removeFiles.mock.calls[0][0].map((r: any) => r.id)).toEqual([10, 11]);
    expect(tables[UIDS.image].map((i) => i.id)).toEqual([12]);
    expect(tables[UIDS.variant].map((v) => v.id)).toEqual([a.id]);
    expect(tables[UIDS.variantTranslation].every((t) => t.variant === a.id)).toBe(true);
  });

  it('does not delete image files when the transaction fails', async () => {
    const { service, tables, imageService, transaction } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A'), variant('B')]));
    const [a, b] = (await service.get(id)).variants;
    tables[UIDS.image].push({ id: 10, variant: b.id, position: 1, url: '/b1' });
    const original = transaction.getMockImplementation()!;
    transaction.mockImplementationOnce((cb: (ctx: { trx: any }) => Promise<any>) =>
      original(async (ctx) => {
        await cb(ctx);
        throw new Error('commit failed');
      })
    );
    await expect(
      service.update(id, { ...input('Camisa', []), variants: [{ ...variant('A'), id: a.id }] })
    ).rejects.toThrow('commit failed');
    expect(imageService.remove).not.toHaveBeenCalled();
    expect(imageService.removeFiles).not.toHaveBeenCalled();
    expect(tables[UIDS.image].map((i) => i.id)).toEqual([10]);
    expect(tables[UIDS.variant]).toHaveLength(2);
  });

  it('update keeps the same SKU on the same product and upserts translations', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A')]));
    const { variants } = await service.get(id);
    await service.update(id, input('Camisa 2', [{ ...variants[0], price: 3000 }]));
    expect(tables[UIDS.productTranslation]).toHaveLength(1);
    expect(tables[UIDS.productTranslation][0].name).toBe('Camisa 2');
    expect(tables[UIDS.variant][0].price).toBe(3000);
    expect(tables[UIDS.variantTranslation]).toHaveLength(1);
  });

  it('strips links from description', async () => {
    const { service, tables } = makeStrapi();
    await service.create(
      input('Camisa', [variant('A')], {
        translations: { en: { name: 'Camisa', description: '<p>ver <a href="x">aqui</a></p>' } },
      })
    );
    expect(tables[UIDS.productTranslation][0].description).toBe('<p>ver aqui</p>');
  });

  it('get returns detail with thumbnails ordering and list thumbnail fallback', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A')]));
    const d = await service.get(id);
    tables[UIDS.image].push({ id: 1, variant: d.variants[0].id, position: 1, url: '/v1' });
    expect((await service.list({ page: 1 })).results[0].thumbnailUrl).toBe('/v1');
    tables[UIDS.image].push({ id: 2, product: id, position: 1, url: '/p1' });
    expect((await service.list({ page: 1 })).results[0].thumbnailUrl).toBe('/p1');
    expect((await service.get(id)).translations.en.slug).toBe('camisa');
  });

  it('exposes locales', async () => {
    const { service } = makeStrapi();
    expect(await service.getDefaultLocale()).toBe('en');
    expect(await service.getLocales()).toEqual([
      { code: 'en', name: 'English' },
      { code: 'pt', name: 'Portuguese' },
    ]);
  });

  it('get and update throw EcommerceNotFoundError for a missing product', async () => {
    const { service } = makeStrapi();
    await expect(service.get(999)).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.update(999, input('Camisa', [variant('A')]))).rejects.toBeInstanceOf(
      EcommerceNotFoundError
    );
  });

  it('update deletes non-default translations that were cleared', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(
      input('Camisa', [variant('A', { translations: { en: { option: 'M' }, pt: { option: 'Médio' } } })], {
        translations: {
          en: { name: 'Shirt', description: '<p>x</p>' },
          pt: { name: 'Camisola', shortDescription: 'Curta', description: '<p>y</p>' },
        },
      })
    );
    expect(tables[UIDS.productTranslation].map((t) => t.locale)).toEqual(['en', 'pt']);
    expect(tables[UIDS.variantTranslation].map((t) => t.locale)).toEqual(['en', 'pt']);
    const { variants } = await service.get(id);

    await service.update(
      id,
      input('Camisa', [{ ...variants[0], translations: { en: { option: 'M' }, pt: { option: '  ' } } }], {
        translations: {
          en: { name: 'Shirt', description: '<p>x</p>' },
          pt: { name: '', shortDescription: '', description: '<p><br></p>' },
        },
      })
    );
    expect(tables[UIDS.productTranslation].map((t) => t.locale)).toEqual(['en']);
    expect(tables[UIDS.variantTranslation].map((t) => t.locale)).toEqual(['en']);
  });

  it('rejects a non-default translation with content but no name', async () => {
    const { service } = makeStrapi();
    const err: any = await service
      .create(
        input('Camisa', [variant('A')], {
          translations: {
            en: { name: 'Shirt', description: '<p>x</p>' },
            pt: { name: '', description: '<p>Camisola</p>' },
          },
        })
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'translations.pt.name', code: 'required' }]);
  });

  it('still requires default-locale name and description', async () => {
    const { service } = makeStrapi();
    const err: any = await service
      .create(input('Camisa', [variant('A')], { translations: { en: { name: ' ', description: '<p></p>' } } }))
      .catch((e) => e);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'translations.en.name', code: 'required' },
        { path: 'translations.en.description', code: 'required' },
      ])
    );
  });

  describe('stock', () => {
    it('saves a product with a variant at negative stock', async () => {
      const { service, tables } = makeStrapi();
      await expect(service.create(input('Camisa', [variant('A', { stock: -2 })]))).resolves.toEqual({
        id: expect.any(Number),
      });
      expect(tables[UIDS.variant][0].stock).toBe(-2);
    });

    it('records the initial stock of a new variant as a MANUAL_ADJUST', async () => {
      const { service, tables } = makeStrapi();
      await service.create(input('Camisa', [variant('A', { stock: 4 }), variant('B', { stock: 0 })]));
      const [a, b] = tables[UIDS.variant];
      expect(a.stock).toBe(4);
      expect(b.stock).toBe(0);
      expect(tables[UIDS.stockMovement]).toEqual([
        expect.objectContaining({
          variantId: a.id,
          type: 'MANUAL_ADJUST',
          quantity: 4,
          operationKey: expect.stringMatching(new RegExp(`^initial:${a.id}:[0-9a-f-]{36}$`)),
          reason: 'initial stock',
          actor: 'system',
        }),
      ]);
    });

    it('stockAdjustment +5 on an existing variant creates a MANUAL_ADJUST and adds 5', async () => {
      const { service, tables } = makeStrapi();
      const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
      const [v] = (await service.get(id)).variants;
      await service.update(id, input('Camisa', [{ ...v, stockAdjustment: 5 }]), 'user:7');
      expect(tables[UIDS.variant][0].stock).toBe(8);
      const adjust = tables[UIDS.stockMovement].filter((m) => m.actor === 'user:7');
      expect(adjust).toHaveLength(1);
      expect(adjust[0]).toMatchObject({ variantId: v.id, type: 'MANUAL_ADJUST', quantity: 5 });
      expect(adjust[0].operationKey).toMatch(new RegExp(`^adjust:${v.id}:[0-9a-f-]{36}$`));
    });

    it('update ignores a different stock on an existing variant', async () => {
      const { service, tables } = makeStrapi();
      const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
      const [v] = (await service.get(id)).variants;
      tables[UIDS.variant][0].stock = 1; // an order took two units meanwhile
      await service.update(id, input('Camisa', [{ ...v, stock: 50, stockAdjustment: 0 }]));
      expect(tables[UIDS.variant][0].stock).toBe(1);
      expect(tables[UIDS.stockMovement]).toHaveLength(1); // only the initial stock
    });

    describe('setting the stock from the admin (stockExpected)', () => {
      const KEY = '11111111-2222-4333-8444-555555555555';

      it('applies the difference when the stock is still the one the admin saw', async () => {
        const { service, tables } = makeStrapi();
        const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
        const [v] = (await service.get(id)).variants;
        // the admin typed 10 over the 3 it saw
        await service.update(
          id,
          input('Camisa', [{ ...v, stockAdjustment: 7, stockAdjustmentKey: KEY, stockExpected: 3 }])
        );
        expect(tables[UIDS.variant][0].stock).toBe(10);
      });

      it('refuses with STOCK_CHANGED when the stock moved meanwhile, and changes nothing', async () => {
        const { service, tables } = makeStrapi();
        const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
        const [v] = (await service.get(id)).variants;
        tables[UIDS.variant][0].stock = 1; // an order took two units
        const err: any = await service
          .update(
            id,
            input('Camisa', [{ ...v, price: 999, stockAdjustment: 7, stockAdjustmentKey: KEY, stockExpected: 3 }])
          )
          .catch((e) => e);
        expect(err).toBeInstanceOf(EcommerceValidationError);
        expect(err.errors).toEqual([{ path: 'variants.0.stock', code: 'STOCK_CHANGED' }]);
        expect(tables[UIDS.variant][0].stock).toBe(1);
        expect(tables[UIDS.variant][0].price).toBe(1000);
      });

      it('accepts a replay of an adjustment that was already applied', async () => {
        const { service, tables } = makeStrapi();
        const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
        const [v] = (await service.get(id)).variants;
        const body = input('Camisa', [{ ...v, stockAdjustment: 7, stockAdjustmentKey: KEY, stockExpected: 3 }]);
        await service.update(id, body);
        await service.update(id, body); // the first response was lost
        expect(tables[UIDS.variant][0].stock).toBe(10);
      });
    });

    it('rejects a non-integer stockAdjustment', async () => {
      const { service } = makeStrapi();
      const { id } = await service.create(input('Camisa', [variant('A')]));
      const [v] = (await service.get(id)).variants;
      const err: any = await service
        .update(id, input('Camisa', [{ ...v, stockAdjustment: 0.5 }]))
        .catch((e) => e);
      expect(err).toBeInstanceOf(EcommerceValidationError);
      expect(err.errors).toEqual([{ path: 'variants.0.stockAdjustment', code: 'invalid_number' }]);
    });

    it('uses the client key so a repeated adjustment applies once', async () => {
      const { service, tables } = makeStrapi();
      const { id } = await service.create(input('Camisa', [variant('A', { stock: 3 })]));
      const [v] = (await service.get(id)).variants;
      const key = '0b9c1d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
      const body = input('Camisa', [{ ...v, stockAdjustment: 5, stockAdjustmentKey: key }]);
      await service.update(id, body, 'user:1');
      await service.update(id, body, 'user:1');
      expect(tables[UIDS.variant][0].stock).toBe(8);
      const adjust = tables[UIDS.stockMovement].filter((m) => m.actor === 'user:1');
      expect(adjust.map((m) => m.operationKey)).toEqual([`adjust:${v.id}:${key}`]);
    });
  });

  it('update can re-create a removed variant SKU on a new variant', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A'), variant('B')]));
    const [a, b] = (await service.get(id)).variants;
    await service.update(id, input('Camisa', [{ ...b }, variant('A', { stock: 2 })]));
    expect(tables[UIDS.variant].map((v) => v.sku)).toEqual(['B', 'A']);
    expect(tables[UIDS.variant].find((v) => v.sku === 'A').id).not.toBe(a.id);
  });
  describe('removing a variant used by orders', () => {
    const withOrder = async (orderStatus: string) => {
      const ctx = makeStrapi();
      const { id } = await ctx.service.create(input('Camisa', [variant('A'), variant('B')]));
      const [a, b] = (await ctx.service.get(id)).variants;
      ctx.tables[UIDS.order].push({ id: 50, orderStatus });
      ctx.tables[UIDS.orderLine].push({ id: 60, order: 50, variantId: b.id, quantity: 1 });
      return { ...ctx, id, a, b };
    };

    it.each(['OPEN', 'CANCELLED', 'ARCHIVED'])(
      'is rejected when a %s order used it, and changes nothing',
      async (status) => {
        const { service, tables, id, a } = await withOrder(status);
        const err: any = await service
          .update(id, input('Camisa', [{ ...a, price: 9999 }]))
          .catch((e) => e);
        expect(err).toBeInstanceOf(EcommerceValidationError);
        expect(err.errors).toEqual([{ path: 'variants.1', code: 'VARIANT_IN_ORDERS' }]);
        expect(tables[UIDS.variant].map((v) => v.sku)).toEqual(['A', 'B']);
        expect(tables[UIDS.variant][0].price).toBe(1000);
      }
    );

    it('a variant never ordered can still be removed', async () => {
      const { service, tables, id, b } = await withOrder('OPEN');
      await service.update(id, input('Camisa', [{ ...b }]));
      expect(tables[UIDS.variant].map((v) => v.sku)).toEqual(['B']);
    });
  });
});

describe('EcommerceProductService — deletable and delete', () => {
  const ordered = async (by: 'variant' | 'product') => {
    const ctx = makeStrapi();
    const { id } = await ctx.service.create(input('Camisa', [variant('A'), variant('B')]));
    const [a, b] = (await ctx.service.get(id)).variants;
    ctx.tables[UIDS.order].push({ id: 50, orderStatus: 'ARCHIVED' });
    ctx.tables[UIDS.orderLine].push(
      by === 'variant'
        ? { id: 60, order: 50, variantId: b.id, quantity: 1 }
        : { id: 60, order: 50, productId: id, variantId: b.id, quantity: 1 }
    );
    return { ...ctx, id, a, b };
  };

  it('get reports a never-ordered product and its variants as deletable', async () => {
    const { service } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A')]));
    const detail = await service.get(id);
    expect(detail.deletable).toBe(true);
    expect(detail.variants.map((v) => v.deletable)).toEqual([true]);
  });

  it.each(['variant', 'product'] as const)(
    'get marks the product and the ordered variant as not deletable (line found by %s)',
    async (by) => {
      const { service, id } = await ordered(by);
      const detail = await service.get(id);
      expect(detail.deletable).toBe(false);
      expect(detail.variants.map((v) => v.deletable)).toEqual([true, false]);
    }
  );

  it('delete removes the product, variants, translations and image rows, then the files', async () => {
    const { service, tables, imageService } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A'), variant('B')]));
    const [a] = (await service.get(id)).variants;
    tables[UIDS.image].push({ id: 900, product: id, url: '/p.png' }, { id: 901, variant: a.id, url: '/v.png' });
    await service.create(input('Other', [variant('Z')]));

    await service.delete(id);

    expect(tables[UIDS.product].map((p) => p.id)).not.toContain(id);
    expect(tables[UIDS.variant].map((v) => v.sku)).toEqual(['Z']);
    expect(tables[UIDS.productTranslation].map((t) => t.name)).toEqual(['Other']);
    expect(tables[UIDS.variantTranslation]).toHaveLength(1);
    expect(tables[UIDS.image]).toEqual([]);
    expect(imageService.removeFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 900 }), expect.objectContaining({ id: 901 })])
    );
    // Stock movements stay as history.
    expect(tables[UIDS.stockMovement].length).toBeGreaterThan(0);
  });

  it('delete refuses an ordered product with PRODUCT_IN_ORDERS and changes nothing', async () => {
    const { service, tables, imageService, id } = await ordered('variant');
    const err: any = await service.delete(id).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'product', code: 'PRODUCT_IN_ORDERS' }]);
    expect(tables[UIDS.product].map((p) => p.id)).toContain(id);
    expect(tables[UIDS.variant]).toHaveLength(2);
    expect(imageService.removeFiles).not.toHaveBeenCalled();
  });

  it('delete of an unknown product is a not-found error', async () => {
    const { service } = makeStrapi();
    await expect(service.delete(404)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });
});

describe('EcommerceProductService — setActive', () => {
  it('changes only the active flag', async () => {
    const { service, tables } = makeStrapi();
    const { id } = await service.create(input('Camisa', [variant('A')]));
    expect(await service.setActive(id, false)).toEqual({ active: false });
    const row = tables[UIDS.product].find((p) => p.id === id);
    expect(row.active).toBe(false);
    expect((await service.get(id)).translations.en.name).toBe('Camisa');
    await service.setActive(id, true);
    expect(tables[UIDS.product].find((p) => p.id === id).active).toBe(true);
  });

  it('is a not-found error for an unknown product', async () => {
    const { service } = makeStrapi();
    await expect(service.setActive(404, true)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });
});
