import { describe, it, expect, vi } from 'vitest';
import { EcommerceValidationError, EcommerceNotFoundError } from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceProductService from '../../../server/src/services/modules/ecommerce/products';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  variantTranslation: `${P}variant-translation`,
  image: `${P}image`,
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
};

function makeStrapi() {
  const { tables, query, transaction } = createFakeDb(Object.values(UIDS), RELATIONS);

  const imageService = { remove: vi.fn(), removeFiles: vi.fn(async () => undefined) };

  const strapi: any = {
    db: { query, transaction },
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
        : { service: () => imageService },
  };
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
    transaction.mockImplementationOnce((cb: () => Promise<any>) =>
      original(async () => {
        await cb();
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
});
