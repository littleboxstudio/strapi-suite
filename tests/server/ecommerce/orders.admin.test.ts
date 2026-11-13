import { describe, it, expect, vi } from 'vitest';
import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { setupCommerce, createOrder, UIDS } from './helpers/commerceSetup';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const product = {
  id: 1,
  active: true,
  translations: [{ locale: 'en', name: 'Shirt' }],
  images: [],
  variants: [
    { id: 10, sku: 'SH-M', price: 2000, tax: 23, stock: 5, weight: 2, width: 3, height: 4, depth: 5, active: true, translations: [{ locale: 'en', option: 'M' }], images: [] },
    { id: 11, sku: 'SH-L', price: 2100, tax: 23, stock: 0, weight: 1, width: 1, height: 1, depth: 1, active: false, translations: [], images: [] },
  ],
};

function setup(products: any[] = [product]) {
  const findMany = vi.fn(async () => products);
  const quote = vi.fn(async (req: any) => ({ options: [], failures: [], req }));
  const strapi: any = {
    db: { query: () => ({ findMany }) },
    config: { get: () => ({ uuid: { modules: { ecommerce: { product: `${P}product` } } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : { service: () => ({ quote }) },
  };
  return { service: EcommerceOrderService({ strapi }), findMany, quote };
}

describe('EcommerceOrderService.quoteForLines', () => {
  it('fills weight and dimensions from the catalog and sums the subtotal', async () => {
    const { service, quote } = setup();
    await service.quoteForLines({
      country: 'PT',
      postalCode: ' 1000 ',
      lines: [{ variantId: 10, quantity: 1 }, { variantId: 10, quantity: 2 }],
      locale: 'en',
    });
    expect(quote).toHaveBeenCalledWith({
      country: 'PT',
      postalCode: '1000',
      items: [{ variantId: 10, quantity: 3, weight: 2, width: 3, height: 4, depth: 5 }],
      subtotal: 6000,
      locale: 'en',
    });
  });

  it('rejects empty lines, bad quantities and unknown variants', async () => {
    const { service } = setup();
    await expect(service.quoteForLines({ country: 'PT', lines: [], locale: 'en' })).rejects.toBeInstanceOf(
      EcommerceValidationError
    );
    await expect(
      service.quoteForLines({ country: 'PT', lines: [{ variantId: 10, quantity: 0 }], locale: 'en' })
    ).rejects.toBeInstanceOf(EcommerceValidationError);
    await expect(
      service.quoteForLines({ country: 'PT', lines: [{ variantId: 99, quantity: 1 }], locale: 'en' })
    ).rejects.toBeInstanceOf(EcommerceValidationError);
  });
  it('rejects inactive and unknown variants as VARIANT_UNAVAILABLE at the line', async () => {
    const { service, quote } = setup();
    const err: any = await service
      .quoteForLines({
        country: 'PT',
        lines: [
          { variantId: 10, quantity: 1 },
          { variantId: 11, quantity: 1 },
          { variantId: 99, quantity: 1 },
        ],
        locale: 'en',
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([
      { path: 'lines.1.variantId', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.2.variantId', code: 'VARIANT_UNAVAILABLE' },
    ]);
    expect(quote).not.toHaveBeenCalled();
  });
});

describe('EcommerceOrderService.searchVariants', () => {
  it('returns only active variants with the documented shape', async () => {
    const { service } = setup();
    expect(await service.searchVariants('shirt', 'en')).toEqual([
      { variantId: 10, productId: 1, name: 'Shirt', option: 'M', sku: 'SH-M', price: 2000, stock: 5, imageUrl: null },
    ]);
  });

  it('matches by SKU and skips blank queries', async () => {
    const { service, findMany } = setup();
    expect((await service.searchVariants('sh-m', 'en')).map((v) => v.variantId)).toEqual([10]);
    findMany.mockClear();
    expect(await service.searchVariants('  ', 'en')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('EcommerceOrderService.get: editing fields', () => {
  const checkout = { id: 1, origin: 'CHECKOUT', amount: 500, paid: false, invoiced: false, spent: false };

  it('a fresh order offers every edit and shows its CHECKOUT shipping line', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const view = await c.orders.get(id);
    expect(view.editing).toEqual({
      editable: true,
      blockedBy: null,
      hasShipments: false,
      actions: [
        'ADD_PRODUCTS',
        'EDIT_ADDRESS',
        'RECALCULATE_SHIPPING',
        'EDIT_SHIPPING_LINE',
        'ADD_SHIPPING_LINE',
        'RECALCULATE_DISCOUNTS',
        'ADD_DISCOUNT',
        'REMOVE_DISCOUNT',
      ],
    });
    expect(view.shippingLines).toHaveLength(1);
    expect(view.shippingLines[0]).toMatchObject({ ...checkout, providerId: 'manual', serviceId: '1', tax: 23 });
    expect(view.manualDiscounts).toEqual([]);
    expect(view.reviewFlags).toEqual([]);
  });

  it('marks the shipping line paid once the total is paid', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await c.payments.addManualPayment(id, { amount: 4500, idempotencyKey: 'pay-view-1' }, 'user:1');
    const view = await c.orders.get(id);
    expect(view.shippingLines[0]).toMatchObject({ ...checkout, paid: true });
  });

  it('a legacy order reads its CHECKOUT line and LEGACY discount without writing', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const row = c.tables[UIDS.order].find((o) => o.id === id);
    Object.assign(row, {
      shippingLines: null,
      manualDiscounts: null,
      reviewFlags: null,
      orderDiscount: 300,
      total: 4200,
    });
    const before = structuredClone(c.tables);
    const view = await c.orders.get(id);
    expect(view.shippingLines).toEqual([expect.objectContaining(checkout)]);
    expect(view.manualDiscounts).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 300, reason: 'Previous manual adjustment' }),
    ]);
    expect(view.reviewFlags).toEqual([]);
    expect(c.tables).toEqual(before);
  });
});
