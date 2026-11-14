import { beforeEach, describe, expect, it } from 'vitest';
import EcommerceShippingService, {
  __resetCarrierQuotersForTests,
  getCarrierAdapter,
} from '../../../../server/src/services/modules/ecommerce/shipping';
import { dpdPortugalAdapter } from '../../../../server/src/services/modules/ecommerce/providers/carriers/dpdPortugal';
import type { DpdServices } from '../../../../server/src/services/modules/ecommerce/domain/dpdServices';

const ID = 'dpd-portugal';
const BRACKETS = (price: number) => [
  { upTo: 1, price },
  { upTo: 5, price: price + 200 },
];

const services = (over: { EXPRESS?: Partial<DpdServices['EXPRESS']>; PICKUP?: Partial<DpdServices['PICKUP']> } = {}): DpdServices => ({
  EXPRESS: { active: true, name: { pt: 'Expresso DPD', en: 'DPD Express EN' }, tax: 23, rates: { PT: BRACKETS(500) }, ...over.EXPRESS },
  PICKUP: { active: true, name: { pt: 'Ponto DPD', en: 'DPD Pickup EN' }, tax: 23, rates: { PT: BRACKETS(300) }, ...over.PICKUP },
});

const CREDS = {
  config: { authEndpoint: 'https://auth.example.test', expeditionEndpoint: 'https://api.example.test', clientId: 'c', username: 'u' },
  secrets: { clientSecret: 's', password: 'p' },
};

function setup(opts: { services?: DpdServices; markets?: string[]; active?: boolean; carriers?: string[]; runtime?: any } = {}) {
  const runtime =
    opts.runtime === undefined
      ? { config: { ...CREDS.config, services: opts.services ?? services() }, secrets: { ...CREDS.secrets }, active: opts.active ?? true }
      : opts.runtime;
  const settings = {
    listManualMethods: async () => [],
    getStoreSettings: async () => ({ markets: opts.markets ?? ['PT', 'ES'] }),
    getActiveProviders: async () => opts.carriers ?? (opts.active === false ? [] : [ID]),
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

describe('DPD Portugal quotes', () => {
  it('is a built-in carrier adapter', () => {
    expect(getCarrierAdapter(ID)?.quote).toBeTypeOf('function');
  });

  it('both services active with PT rates give two options; PICKUP requires a pickup point', async () => {
    const { options, failures } = await setup().quote(req());
    expect(failures).toEqual([]);
    expect(options).toEqual([
      { providerId: ID, serviceId: 'PICKUP', name: 'DPD Pickup EN', price: 300, tax: 23, requiresPickupPoint: true },
      { providerId: ID, serviceId: 'EXPRESS', name: 'DPD Express EN', price: 500, tax: 23 },
    ]);
  });

  it('uses the bracket that fits the order weight', async () => {
    const { options } = await setup().quote(req({ items: [item(1.5, 2)] }));
    expect(options.map((o) => o.price)).toEqual([500, 700]);
  });

  it('names fall back to the default locale, then to the service default', async () => {
    const s = setup({
      services: services({ EXPRESS: { name: { pt: 'Expresso DPD' } }, PICKUP: { name: { fr: 'Point' } } }),
    });
    const { options } = await s.quote(req());
    expect(options.map((o) => o.name)).toEqual(['DPD Pickup', 'Expresso DPD']);
  });

  it('an inactive EXPRESS gives only PICKUP', async () => {
    const { options } = await setup({ services: services({ EXPRESS: { active: false } }) }).quote(req());
    expect(options.map((o) => o.serviceId)).toEqual(['PICKUP']);
  });

  it('a weight above the last bracket gives no option', async () => {
    expect(await setup().quote(req({ items: [item(6)] }))).toEqual({ options: [], failures: [] });
  });

  it('a market without a rate table has no DPD option and is not a failure', async () => {
    expect(await setup().quote(req({ country: 'ES', postalCode: '28001' }))).toEqual({ options: [], failures: [] });
  });

  it('the services rates decide the served markets, not config.markets', async () => {
    const s = setup({ services: services({ EXPRESS: { rates: { ES: BRACKETS(900) } }, PICKUP: { active: false } }) });
    const { options } = await s.quote(req({ country: 'ES', postalCode: '28001' }));
    expect(options).toEqual([{ providerId: ID, serviceId: 'EXPRESS', name: 'DPD Express EN', price: 900, tax: 23 }]);
  });

  describe('Portugal - Ilhas (Review Focus 1)', () => {
    const islandServices = () =>
      services({
        EXPRESS: { rates: { PT: BRACKETS(500), 'PT-ISL': BRACKETS(1500) } },
        PICKUP: { rates: { PT: BRACKETS(300) } },
      });
    const island = req({ postalCode: '9000-001' });

    it('an island postcode gets the PT-ISL rates when the store sells to PT-ISL', async () => {
      const { options } = await setup({ services: islandServices(), markets: ['PT', 'PT-ISL'] }).quote(island);
      expect(options.map((o) => `${o.serviceId}:${o.price}`)).toEqual(['EXPRESS:1500']);
    });

    it('without PT-ISL in the store an island postcode keeps the PT rates', async () => {
      const { options } = await setup({ services: islandServices(), markets: ['PT'] }).quote(island);
      expect(options.map((o) => `${o.serviceId}:${o.price}`)).toEqual(['PICKUP:300', 'EXPRESS:500']);
    });
  });

  it('an inactive integration is never quoted', async () => {
    expect(await setup({ active: false }).quote(req())).toEqual({ options: [], failures: [] });
  });

  describe('the adapter alone', () => {
    const rt = (s: DpdServices) => ({ config: { services: s }, secrets: {} });

    it('without a market it uses the request country', async () => {
      const options = await dpdPortugalAdapter.quote!(req() as any, rt(services()));
      expect(options.map((o) => o.serviceId).sort()).toEqual(['EXPRESS', 'PICKUP']);
    });

    it('reads the stored services leniently (missing services give nothing)', async () => {
      expect(await dpdPortugalAdapter.quote!(req() as any, { config: {}, secrets: {} })).toEqual([]);
    });
  });

  describe('servedCountries', () => {
    it('a DPD service serves the markets of its rate table inside the store markets', async () => {
      const s = setup({
        services: services({ EXPRESS: { rates: { PT: BRACKETS(1), ES: BRACKETS(1), FR: BRACKETS(1) } } }),
        markets: ['PT', 'ES'],
      });
      expect(await s.servedCountries(ID, 'EXPRESS')).toEqual(['PT', 'ES']);
      expect(await s.servedCountries(ID, 'PICKUP')).toEqual(['PT']);
    });

    it('ignores config.markets', async () => {
      const s = setup({
        runtime: { config: { markets: ['ES'], services: services() }, secrets: {}, active: true },
      });
      expect(await s.servedCountries(ID, 'EXPRESS')).toEqual(['PT']);
    });
  });

  describe('carrierFor (Review Focus 2)', () => {
    it('with forShipment, an inactive integration with credentials is accepted', async () => {
      const s = setup({ active: false, services: services({ EXPRESS: { active: false }, PICKUP: { active: false } }) });
      const r = await s.carrierFor(ID, { forShipment: true });
      expect(r.adapter.quote).toBeTypeOf('function');
      expect(r.runtime.secrets).toEqual(CREDS.secrets);
    });

    it('without the flag an inactive integration throws CARRIER_NOT_CONFIGURED', async () => {
      await expect(setup({ active: false }).carrierFor(ID)).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
    });

    it('with forShipment, missing credentials still throw', async () => {
      for (const missing of ['authEndpoint', 'expeditionEndpoint', 'clientId', 'username', 'clientSecret', 'password']) {
        const config: Record<string, unknown> = { ...CREDS.config, services: services() };
        const secrets: Record<string, string> = { ...CREDS.secrets };
        delete config[missing];
        delete secrets[missing];
        const s = setup({ runtime: { config, secrets, active: false } });
        await expect(s.carrierFor(ID, { forShipment: true })).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
      }
      const blank = setup({ runtime: { config: { ...CREDS.config, clientId: '  ' }, secrets: CREDS.secrets, active: false } });
      await expect(blank.carrierFor(ID, { forShipment: true })).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
    });

    it('other providers keep requiring an active integration with forShipment', async () => {
      const s = setup({ runtime: null });
      await expect(s.carrierFor('ctt-expresso', { forShipment: true })).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
    });
  });
});
