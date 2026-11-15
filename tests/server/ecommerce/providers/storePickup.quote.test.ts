import { beforeEach, describe, expect, it } from 'vitest';
import EcommerceShippingService, {
  __resetCarrierQuotersForTests,
  getCarrierAdapter,
} from '../../../../server/src/services/modules/ecommerce/shipping';

const ID = 'store-pickup';
const store = (n: string, over: Record<string, unknown> = {}) => ({
  id: `st_${n.padEnd(10, 'a')}`,
  name: `Loja ${n}`,
  address: 'Rua A 1',
  address2: null,
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  ...over,
});
const islandStore = store('isl', { postalCode: '9000-001', city: 'Funchal' });
const BRACKETS = [{ upTo: 1, price: 0 }, { upTo: 5, price: 250 }];

const config = (over: Record<string, unknown> = {}) => ({
  storePickup: {
    name: { pt: 'Levantar na loja', en: 'Pick up in store' },
    tax: 23,
    rates: { PT: BRACKETS, 'PT-ISL': BRACKETS },
    stores: { PT: [store('one'), store('two')], 'PT-ISL': [islandStore] },
    ...over,
  },
});

function setup(opts: { cfg?: Record<string, unknown>; markets?: string[] } = {}) {
  const runtime = { config: opts.cfg ?? config(), secrets: {}, active: true };
  const settings = {
    listManualMethods: async () => [],
    getStoreSettings: async () => ({ markets: opts.markets ?? ['PT', 'PT-ISL', 'ES'] }),
    getActiveProviders: async () => [ID],
    getRuntime: async (id: string) => (id === ID ? runtime : null),
  };
  const strapi: any = {
    log: { warn: () => {} },
    plugin: (id: string) =>
      id === 'i18n' ? { service: () => ({ getDefaultLocale: async () => 'pt' }) } : { service: () => settings },
  };
  return EcommerceShippingService({ strapi });
}

const item = (weight: number, quantity = 1) => ({ variantId: 1, quantity, weight, width: 0, height: 0, depth: 0 });
const req = (over: Record<string, unknown> = {}) => ({
  country: 'PT',
  postalCode: '1000-001',
  items: [item(0.5)],
  subtotal: 1000,
  locale: 'en',
  ...over,
});

beforeEach(() => __resetCarrierQuotersForTests());

describe('Store pickup quotes', () => {
  it('is a built-in adapter with quote only', () => {
    const adapter = getCarrierAdapter(ID)!;
    expect(adapter.quote).toBeTypeOf('function');
    expect(adapter.createShipment).toBeUndefined();
  });

  it("quotes one STORE option with the market's stores", async () => {
    const { options, failures } = await setup().quote(req());
    expect(failures).toEqual([]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      providerId: ID,
      serviceId: 'STORE',
      name: 'Pick up in store',
      price: 0,
      tax: 23,
      requiresPickupPoint: true,
    });
    expect(options[0].pickupPoints!.map((p) => p.id)).toEqual(['st_oneaaaaaaa', 'st_twoaaaaaaa']);
  });

  it('prices by the order weight', async () => {
    expect((await setup().quote(req({ items: [item(3)] }))).options[0].price).toBe(250);
  });

  it('no option without stores for the market', async () => {
    const s = setup({ markets: ['PT', 'ES'] });
    expect((await s.quote(req({ country: 'ES', postalCode: '28001' }))).options).toEqual([]);
    const noStores = setup({ cfg: config({ stores: { 'PT-ISL': [islandStore] } }) });
    expect((await noStores.quote(req())).options).toEqual([]);
  });

  it('no option when no bracket fits the weight', async () => {
    expect((await setup().quote(req({ items: [item(6)] }))).options).toEqual([]);
  });

  it('uses the PT-ISL market for a 9xxx address when PT-ISL is a store market', async () => {
    const { options } = await setup().quote(req({ postalCode: '9000-001' }));
    expect(options[0].pickupPoints!.map((p) => p.id)).toEqual(['st_islaaaaaaa']);
    // Without PT-ISL as a store market the same address is mainland PT.
    const mainland = await setup({ markets: ['PT'] }).quote(req({ postalCode: '9000-001' }));
    expect(mainland.options[0].pickupPoints).toHaveLength(2);
  });

  it("name in locale, default locale, then 'Store pickup'", async () => {
    const s = setup();
    expect((await s.quote(req({ locale: 'pt' }))).options[0].name).toBe('Levantar na loja');
    expect((await s.quote(req({ locale: 'fr' }))).options[0].name).toBe('Levantar na loja');
    const nameless = setup({ cfg: config({ name: { xx: 'x' } }) });
    expect((await nameless.quote(req({ locale: 'fr' }))).options[0].name).toBe('Store pickup');
  });
});
