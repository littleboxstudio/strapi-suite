import { afterEach, describe, expect, it } from 'vitest';
import { EcommerceValidationError } from '../../../../server/src/services/modules/ecommerce/errors';
import {
  __resetRegistryForTests,
  getProviderDefinition,
} from '../../../../server/src/services/modules/ecommerce/providers/registry';
import { STORE_PICKUP_DEFAULTS } from '../../../../server/src/services/modules/ecommerce/domain/storePickup';
import { makeStrapi } from '../helpers/settingsStrapi';

const ID = 'store-pickup';
const RATE = [{ upTo: null, price: 0 }];
const STORE = { name: 'Loja Porto', address: 'Rua X 1', postalCode: '4000-001', city: 'Porto' };

const withMarkets = async () => {
  const ctx = makeStrapi();
  await ctx.service.updateStoreSettings({ markets: ['PT', 'PT-ISL', 'ES'] });
  return ctx;
};

afterEach(() => __resetRegistryForTests());

describe('Store pickup definition', () => {
  it('is a non-exclusive carrier without fields nor connection test', () => {
    const def = getProviderDefinition(ID)!;
    expect(def).toMatchObject({ id: ID, category: 'carrier', name: 'Store pickup', exclusive: false, fields: [] });
    expect(def.testConnection).toBeUndefined();
  });
});

describe('Store pickup settings', () => {
  it('returns the defaults before any save', async () => {
    const { service } = makeStrapi();
    expect(await service.getStorePickup()).toEqual(STORE_PICKUP_DEFAULTS);
  });

  it('findStore finds a store of the market in the current config', async () => {
    const { service } = await withMarkets();
    const res = await service.saveStorePickup({ rates: { PT: RATE }, stores: { PT: [STORE] } });
    const id = res.config.stores.PT[0].id;
    expect(await service.findStore('PT', id)).toEqual(res.config.stores.PT[0]);
    expect(await service.findStore('PT-ISL', id)).toBeNull();
    expect(await service.findStore('PT', 'st_unknown000')).toBeNull();
  });

  it('saves and reads the config', async () => {
    const { service } = await withMarkets();
    const res = await service.saveStorePickup(
      { name: { en: 'Pickup', pt: 'Levantamento' }, tax: 6, rates: { PT: RATE }, stores: { PT: [STORE] } },
      '1'
    );
    expect(res.active).toBe(false);
    expect(res.config.stores.PT[0]).toMatchObject({ ...STORE, address2: null, country: 'PT' });
    expect(res.config.stores.PT[0].id).toMatch(/^st_[a-z0-9]{10}$/);
    expect(await service.getStorePickup()).toEqual(res.config);

    // Saving again with the same id keeps it.
    const id = res.config.stores.PT[0].id;
    const again = await service.saveStorePickup({ ...res.config, stores: { PT: [{ ...STORE, id, city: 'Gaia' }] } });
    expect(again.config.stores.PT[0]).toMatchObject({ id, city: 'Gaia' });
  });

  it('refuses an invalid config without saving', async () => {
    const { service } = await withMarkets();
    const err: any = await service
      .saveStorePickup({ rates: { PT: RATE }, stores: { PT: [{ ...STORE, name: '' }] } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'stores.PT.0.name', code: 'required' }]);
    expect(await service.getStorePickup()).toEqual(STORE_PICKUP_DEFAULTS);
  });

  it('saving without served markets turns the module off', async () => {
    const { service } = await withMarkets();
    await service.saveStorePickup({ rates: { PT: RATE }, stores: { PT: [STORE] } });
    await service.setActive(ID, true);
    const kept = await service.saveStorePickup({ rates: { PT: RATE }, stores: { PT: [STORE] } });
    expect(kept.active).toBe(true);
    const res = await service.saveStorePickup({ rates: { PT: RATE }, stores: {} }, '1');
    expect(res.active).toBe(false);
    expect((await service.listIntegrations()).find((i) => i.id === ID)!.active).toBe(false);
    expect((await service.getRuntime(ID))!.active).toBe(false);
  });

  it('activating without stores is refused with NO_MARKET_WITH_STORES', async () => {
    const { service } = await withMarkets();
    let err: any = await service.setActive(ID, true).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'rates', code: 'NO_MARKET_WITH_STORES' }]);

    await service.saveStorePickup({ rates: { PT: RATE }, stores: { ES: [{ ...STORE, postalCode: '28001' }] } });
    err = await service.setActive(ID, true).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'rates', code: 'NO_MARKET_WITH_STORES' }]);

    await service.saveStorePickup({ rates: { PT: RATE }, stores: { PT: [STORE] } });
    expect((await service.setActive(ID, true)).active).toBe(true);
  });

  it('the integration view includes config.storePickup', async () => {
    const { service } = await withMarkets();
    const { config } = await service.saveStorePickup({ rates: { PT: RATE }, stores: { PT: [STORE] } });
    const rt = await service.getRuntime(ID);
    expect(rt!.config.storePickup).toEqual(config);
    // A generic integration save keeps it.
    await service.updateIntegration(ID, { config: {} });
    expect(await service.getStorePickup()).toEqual(config);
  });

  it('removing a store market used by store pickup fails with MARKET_IN_USE', async () => {
    const { service } = await withMarkets();
    await service.saveStorePickup({ stores: { 'PT-ISL': [{ ...STORE, postalCode: '9000-001' }] } });
    const err: any = await service.updateStoreSettings({ markets: ['PT', 'ES'] }).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'markets', code: 'MARKET_IN_USE', detail: 'Store pickup' }]);
    await service.saveStorePickup({ rates: { ES: RATE } });
    const err2: any = await service.updateStoreSettings({ markets: ['PT', 'PT-ISL'] }).catch((e) => e);
    expect(err2.errors).toEqual([{ path: 'markets', code: 'MARKET_IN_USE', detail: 'Store pickup' }]);
    await expect(service.updateStoreSettings({ markets: ['PT', 'ES'] })).resolves.toMatchObject({
      markets: ['PT', 'ES'],
    });
  });
});

describe('Store pickup stores outside their market', () => {
  it('findStore ignores a PT store with a 9xxx postcode once PT-ISL is a store market', async () => {
    const ctx = makeStrapi();
    await ctx.service.updateStoreSettings({ markets: ['PT'] });
    const res = await ctx.service.saveStorePickup({
      rates: { PT: RATE },
      stores: { PT: [STORE, { ...STORE, name: 'Loja Funchal', postalCode: '9000-001', city: 'Funchal' }] },
    });
    const [porto, funchal] = res.config.stores.PT;
    expect(await ctx.service.findStore('PT', funchal.id)).toEqual(funchal);
    await ctx.service.updateStoreSettings({ markets: ['PT', 'PT-ISL'] });
    expect(await ctx.service.findStore('PT', funchal.id)).toBeNull();
    expect(await ctx.service.findStore('PT-ISL', funchal.id)).toBeNull();
    expect(await ctx.service.findStore('PT', porto.id)).toEqual(porto);
  });
});
