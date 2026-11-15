import { describe, expect, it } from 'vitest';
import {
  normalizeStorePickup,
  PickupStore,
  readStorePickup,
  STORE_PICKUP_DEFAULTS,
  STORE_PICKUP_ID,
  STORE_PICKUP_SERVICE_ID,
  storePickupActivationIssues,
  servedStores,
  storePickupServedMarkets,
  StorePickupConfig,
  storesFor,
} from '../../../../server/src/services/modules/ecommerce/domain/storePickup';

const MARKETS = ['PT', 'PT-ISL', 'ES'];
const RATE = [{ upTo: null, price: 0 }];
const STORE = { name: 'Loja Porto', address: 'Rua X 1', postalCode: '4000-001', city: 'Porto' };

let seq = 0;
const ids = () => `st_${String(++seq).padStart(10, '0')}`;

const normalize = (input: unknown, markets = MARKETS) => {
  const errors: { path: string; code: string }[] = [];
  const config = normalizeStorePickup(input, markets, errors, ids);
  return { config, errors };
};

const stored = (id: string, over: Partial<PickupStore> = {}): PickupStore => ({
  id,
  name: 'Loja',
  address: 'Rua 1',
  address2: null,
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  ...over,
});

const config = (over: Partial<StorePickupConfig> = {}): StorePickupConfig => ({
  ...STORE_PICKUP_DEFAULTS,
  name: { ...STORE_PICKUP_DEFAULTS.name },
  ...over,
});

describe('store pickup constants', () => {
  it('has the provider and service ids and the defaults', () => {
    expect(STORE_PICKUP_ID).toBe('store-pickup');
    expect(STORE_PICKUP_SERVICE_ID).toBe('STORE');
    expect(STORE_PICKUP_DEFAULTS).toEqual({
      name: { en: 'Store pickup', pt: 'Levantamento em loja' },
      tax: 23,
      rates: {},
      stores: {},
    });
  });
});

describe('normalizeStorePickup', () => {
  it('normalizes names, tax and rates like DPD', () => {
    const { config: out, errors } = normalize({ name: { en: ' Pickup ', pt: '' }, tax: 6, rates: { pt: RATE } });
    expect(errors).toEqual([]);
    expect(out).toEqual({ name: { en: 'Pickup' }, tax: 6, rates: { PT: RATE }, stores: {} });

    expect(normalize(undefined).config).toEqual(STORE_PICKUP_DEFAULTS);
    expect(normalize({ name: {} }).config.name).toEqual({ en: 'Store pickup', pt: 'Levantamento em loja' });
    expect(normalize({ tax: 101 }).errors).toEqual([{ path: 'tax', code: 'out_of_range' }]);
    expect(normalize({ tax: 'x' }).errors).toEqual([{ path: 'tax', code: 'invalid_number' }]);
    expect(normalize({ rates: { FR: RATE } }).errors).toEqual([{ path: 'rates.FR', code: 'invalid_country' }]);
    expect(normalize({ rates: { PT: [] } }).errors).toEqual([{ path: 'rates.PT', code: 'required' }]);
  });

  it('generates st_ ids for new stores and keeps existing ids', () => {
    const { config: out, errors } = normalize({
      stores: {
        pt: [
          { ...STORE, address2: '  ' },
          { ...STORE, id: 'st_abcde12345', name: ' Loja Lisboa ', address2: ' 2º ', postalCode: '1000-001', city: 'Lisboa' },
        ],
      },
    });
    expect(errors).toEqual([]);
    expect(out.stores.PT).toHaveLength(2);
    expect(out.stores.PT[0]).toEqual({
      id: expect.stringMatching(/^st_[a-z0-9]{10}$/),
      name: 'Loja Porto',
      address: 'Rua X 1',
      address2: null,
      postalCode: '4000-001',
      city: 'Porto',
      country: 'PT',
    });
    expect(out.stores.PT[1]).toEqual({
      id: 'st_abcde12345',
      name: 'Loja Lisboa',
      address: 'Rua X 1',
      address2: '2º',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
    });
  });

  it('the default id generator makes st_ + 10 lowercase alphanumerics, unique ids', () => {
    const errors: { path: string; code: string }[] = [];
    const out = normalizeStorePickup({ stores: { ES: [STORE, STORE, STORE] } }, MARKETS, errors);
    expect(errors).toEqual([]);
    const got = out.stores.ES.map((s) => s.id);
    for (const id of got) expect(id).toMatch(/^st_[a-z0-9]{10}$/);
    expect(new Set(got).size).toBe(3);
    expect(out.stores.ES[0].country).toBe('ES');
  });

  it('a repeated id is replaced by a new one', () => {
    const { config: out } = normalize({
      stores: { PT: [{ ...STORE, id: 'st_abcde12345' }], ES: [{ ...STORE, id: 'st_abcde12345' }] },
    });
    expect(out.stores.PT[0].id).toBe('st_abcde12345');
    expect(out.stores.ES[0].id).not.toBe('st_abcde12345');
    expect(out.stores.ES[0].id).toMatch(/^st_[a-z0-9]{10}$/);
  });

  it('rejects a store without name/address/postalCode/city', () => {
    const { errors } = normalize({ stores: { PT: [{ name: ' ', address2: null }] } });
    expect(errors).toEqual([
      { path: 'stores.PT.0.name', code: 'required' },
      { path: 'stores.PT.0.address', code: 'required' },
      { path: 'stores.PT.0.postalCode', code: 'required' },
      { path: 'stores.PT.0.city', code: 'required' },
    ]);
  });

  it('rejects fields over their limits', () => {
    const { errors } = normalize({
      stores: {
        PT: [
          {
            name: 'n'.repeat(121),
            address: 'a'.repeat(201),
            address2: 'b'.repeat(201),
            postalCode: '1'.repeat(21),
            city: 'c'.repeat(101),
          },
        ],
      },
    });
    expect(errors).toEqual([
      { path: 'stores.PT.0.name', code: 'too_long' },
      { path: 'stores.PT.0.address', code: 'too_long' },
      { path: 'stores.PT.0.address2', code: 'too_long' },
      { path: 'stores.PT.0.postalCode', code: 'too_long' },
      { path: 'stores.PT.0.city', code: 'too_long' },
    ]);
    const atLimit = normalize({
      stores: {
        ES: [
          {
            name: 'n'.repeat(120),
            address: 'a'.repeat(200),
            address2: 'b'.repeat(200),
            postalCode: '1'.repeat(20),
            city: 'c'.repeat(100),
          },
        ],
      },
    });
    expect(atLimit.errors).toEqual([]);
  });

  it('rejects a 9xxx store under PT when PT-ISL is a store market', () => {
    const { errors } = normalize({ stores: { PT: [{ ...STORE, postalCode: '9000-001', city: 'Funchal' }] } });
    expect(errors).toEqual([{ path: 'stores.PT.0.postalCode', code: 'STORE_MARKET_MISMATCH' }]);
    // And a mainland store under PT-ISL.
    expect(normalize({ stores: { 'PT-ISL': [STORE] } }).errors).toEqual([
      { path: 'stores.PT-ISL.0.postalCode', code: 'STORE_MARKET_MISMATCH' },
    ]);
    const ok = normalize({ stores: { 'PT-ISL': [{ ...STORE, postalCode: '9000-001' }] } });
    expect(ok.errors).toEqual([]);
    expect(ok.config.stores['PT-ISL'][0].country).toBe('PT');
  });

  it('accepts a 9xxx store under PT when PT-ISL is not a store market', () => {
    const { config: out, errors } = normalize(
      { stores: { PT: [{ ...STORE, postalCode: '9000-001', city: 'Funchal' }] } },
      ['PT', 'ES']
    );
    expect(errors).toEqual([]);
    expect(out.stores.PT).toHaveLength(1);
  });

  it('rejects more than 100 stores', () => {
    const many = Array.from({ length: 101 }, () => STORE);
    expect(normalize({ stores: { PT: many } }).errors).toEqual([{ path: 'stores.PT', code: 'too_many' }]);
    expect(normalize({ stores: { PT: many.slice(1) } }).errors).toEqual([]);
  });

  it('rejects stores for a market that is not a store market', () => {
    expect(normalize({ stores: { FR: [STORE] } }).errors).toEqual([{ path: 'stores.FR', code: 'invalid_market' }]);
  });
});

describe('readStorePickup', () => {
  it('falls back to the defaults', () => {
    expect(readStorePickup(undefined)).toEqual(STORE_PICKUP_DEFAULTS);
    expect(readStorePickup('x')).toEqual(STORE_PICKUP_DEFAULTS);
  });

  it('keeps valid parts and drops invalid stores', () => {
    const out = readStorePickup({
      name: { en: 'Pickup' },
      tax: 6,
      rates: { PT: RATE, ES: 'bad' },
      stores: {
        PT: [stored('st_aaaaaaaaaa'), { ...stored('st_bbbbbbbbbb'), name: '' }, 'x', { ...stored('bad-id') }],
        'not a market': [stored('st_cccccccccc')],
        ES: 'bad',
      },
    });
    expect(out).toEqual({
      name: { en: 'Pickup' },
      tax: 6,
      rates: { PT: RATE },
      stores: { PT: [stored('st_aaaaaaaaaa')] },
    });
  });
});

describe('served markets and activation', () => {
  const both = config({
    rates: { PT: RATE, ES: RATE, 'PT-ISL': RATE },
    stores: { PT: [stored('st_aaaaaaaaaa')], 'PT-ISL': [stored('st_bbbbbbbbbb', { postalCode: '9000-001' })] },
  });

  it('served markets need rates and a store', () => {
    expect(storePickupServedMarkets(both, MARKETS)).toEqual(['PT', 'PT-ISL']);
    expect(storePickupServedMarkets(both, ['ES', 'PT-ISL'])).toEqual(['PT-ISL']);
    expect(storePickupServedMarkets(config({ stores: { PT: [stored('st_aaaaaaaaaa')] } }), MARKETS)).toEqual([]);
    expect(storePickupServedMarkets(config({ rates: { PT: RATE } }), MARKETS)).toEqual([]);
  });

  it('activation issues when no market has rates and stores', () => {
    expect(storePickupActivationIssues(both, MARKETS)).toEqual([]);
    expect(storePickupActivationIssues(config({ rates: { PT: RATE } }), MARKETS)).toEqual([
      { path: 'rates', code: 'NO_MARKET_WITH_STORES' },
    ]);
    expect(storePickupActivationIssues(both, ['ES'])).toEqual([{ path: 'rates', code: 'NO_MARKET_WITH_STORES' }]);
  });

  it('storesFor returns the market stores or none', () => {
    expect(storesFor(both, 'PT')).toEqual([stored('st_aaaaaaaaaa')]);
    expect(storesFor(both, 'ES')).toEqual([]);
  });
});

describe('servedStores', () => {
  const stranded = config({
    rates: { PT: RATE },
    stores: { PT: [stored('st_aaaaaaaaaa'), stored('st_bbbbbbbbbb', { postalCode: '9000-001' })] },
  });

  it('drops the stores whose postcode is no longer in the market', () => {
    expect(servedStores(stranded, 'PT', ['PT']).map((s) => s.id)).toEqual(['st_aaaaaaaaaa', 'st_bbbbbbbbbb']);
    expect(servedStores(stranded, 'PT', MARKETS).map((s) => s.id)).toEqual(['st_aaaaaaaaaa']);
    expect(servedStores(stranded, 'PT-ISL', MARKETS)).toEqual([]);
  });

  it('a market is served only with a served store', () => {
    const only = config({ rates: { PT: RATE }, stores: { PT: [stored('st_bbbbbbbbbb', { postalCode: '9000-001' })] } });
    expect(storePickupServedMarkets(only, ['PT'])).toEqual(['PT']);
    expect(storePickupServedMarkets(only, MARKETS)).toEqual([]);
  });
});
