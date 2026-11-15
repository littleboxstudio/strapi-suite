import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const client = vi.hoisted(() => ({ searchPudo: vi.fn() }));
vi.mock('../../../server/src/services/modules/ecommerce/providers/carriers/dpd/pickupClient', async (orig) => ({
  ...(await orig<object>()),
  searchPudo: client.searchPudo,
}));

import EcommercePickupPointService, {
  __clearPickupCacheForTests,
  PICKUP_CACHE_TTL_MS,
} from '../../../server/src/services/modules/ecommerce/pickupPoints';
import { EcommerceCarrierError, EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { QUOTE_TIMEOUT_MS } from '../../../server/src/services/modules/ecommerce/shipping';
import { DPD_PICKUP_ENDPOINT_DEFAULT } from '../../../server/src/services/modules/ecommerce/providers/definitions/dpd-portugal';

const BRACKETS = [{ upTo: null, price: 400 }];
const point = (id: string) => ({
  id,
  name: `Loja ${id}`,
  address: 'Rua A 1',
  address2: null,
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT' as const,
  openingHours: [{ day: 1, from: '09:00', to: '19:00' }],
});

type Opts = { runtime?: any; markets?: string[] };
const runtime = (over: { active?: boolean; pickup?: any; config?: any; secrets?: any } = {}) => ({
  active: over.active ?? true,
  config: {
    pickupEndpoint: 'https://pudo.example/mypudo.asmx?wsdl',
    services: {
      EXPRESS: { active: true, name: {}, tax: 23, rates: { PT: BRACKETS } },
      PICKUP: { active: true, name: {}, tax: 23, rates: { PT: BRACKETS }, ...over.pickup },
    },
    ...over.config,
  },
  secrets: { pickupKey: 'KEY', ...over.secrets },
});

let warn: ReturnType<typeof vi.fn>;
function setup(opts: Opts = {}) {
  const settings = {
    getRuntime: vi.fn(async () => ('runtime' in opts ? opts.runtime : runtime())),
    getStoreSettings: async () => ({ markets: opts.markets ?? ['PT', 'ES'] }),
  };
  warn = vi.fn();
  const strapi: any = { log: { warn }, plugin: () => ({ service: () => settings }) };
  return EcommercePickupPointService({ strapi });
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof EcommerceValidationError) return (err.errors[0] as any).code;
    if (err instanceof EcommerceCarrierError) return err.code;
    throw err;
  }
  return 'OK';
};

beforeEach(() => {
  __clearPickupCacheForTests();
  client.searchPudo.mockReset();
  client.searchPudo.mockResolvedValue([point('A'), point('B')]);
});
afterEach(() => vi.useRealTimers());

describe('EcommercePickupPointService.search', () => {
  it('returns the points of the client, with the configured endpoint, key and the quote timeout', async () => {
    const s = setup();
    expect(await s.search({ postalCode: '1000-001' })).toEqual([point('A'), point('B')]);
    expect(client.searchPudo).toHaveBeenCalledWith('https://pudo.example/mypudo.asmx?wsdl', 'KEY', '1000-001', {
      timeoutMs: QUOTE_TIMEOUT_MS,
    });
  });

  it('formats 7 digits as NNNN-NNN and uses the default endpoint when none is configured', async () => {
    const s = setup({ runtime: runtime({ config: { pickupEndpoint: '' } }) });
    await s.search({ postalCode: '1000001', country: 'PT' });
    expect(client.searchPudo).toHaveBeenCalledWith(DPD_PICKUP_ENDPOINT_DEFAULT, 'KEY', '1000-001', expect.anything());
  });

  it.each(['', '1000', '1000-01', '10000-001', 'abcd-efg', ' 1000-001', '1000 001'])(
    'rejects the postal code %j with INVALID_POSTAL_CODE',
    async (postalCode) => {
      expect(await codeOf(setup().search({ postalCode }))).toBe('INVALID_POSTAL_CODE');
      expect(client.searchPudo).not.toHaveBeenCalled();
    }
  );

  it('a non-string postal code is INVALID_POSTAL_CODE', async () => {
    expect(await codeOf(setup().search({ postalCode: 1000001 as any }))).toBe('INVALID_POSTAL_CODE');
  });

  it('the country is case-insensitive: pt searches Portugal', async () => {
    const s = setup();
    expect(await s.search({ postalCode: '1000-001', country: 'pt' })).toEqual([point('A'), point('B')]);
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
  });

  it('a country other than PT is PICKUP_NOT_AVAILABLE (path country)', async () => {
    const err = await setup()
      .search({ postalCode: '28001', country: 'ES' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'country', code: 'PICKUP_NOT_AVAILABLE' }]);
  });

  it.each([
    ['no integration', { runtime: null }],
    ['an inactive integration', { runtime: runtime({ active: false }) }],
    ['PICKUP inactive', { runtime: runtime({ pickup: { active: false } }) }],
    ['PICKUP without a PT table', { runtime: runtime({ pickup: { rates: { ES: BRACKETS } } }) }],
    ['PT not a store market', { markets: ['ES'] }],
    ['no pickup key', { runtime: runtime({ secrets: { pickupKey: '' } }) }],
  ] as [string, Opts][])('%s → PICKUP_NOT_AVAILABLE without calling DPD', async (_, opts) => {
    expect(await codeOf(setup(opts).search({ postalCode: '1000-001' }))).toBe('PICKUP_NOT_AVAILABLE');
    expect(client.searchPudo).not.toHaveBeenCalled();
  });

  it('an island postcode needs a PT-ISL PICKUP table when the store sells to PT-ISL', async () => {
    const markets = ['PT', 'PT-ISL'];
    expect(await codeOf(setup({ markets }).search({ postalCode: '9000-001' }))).toBe('PICKUP_NOT_AVAILABLE');
    const islands = runtime({ pickup: { rates: { PT: BRACKETS, 'PT-ISL': BRACKETS } } });
    expect(await codeOf(setup({ markets, runtime: islands }).search({ postalCode: '9000-001' }))).toBe('OK');
    // Without PT-ISL in the store, an island postcode is PT.
    expect(await codeOf(setup().search({ postalCode: '9500-001' }))).toBe('OK');
  });

  it('a PT-ISL table that is not a store market does not serve the islands', async () => {
    const islands = runtime({ pickup: { rates: { 'PT-ISL': BRACKETS } } });
    // The store has no PT-ISL: the islands are PT, and PICKUP has no PT table.
    expect(await codeOf(setup({ runtime: islands }).search({ postalCode: '9000-001' }))).toBe('PICKUP_NOT_AVAILABLE');
  });

  it('caches by postal code for 10 minutes (one client call for two searches)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const s = setup();
    await s.search({ postalCode: '1000-001' });
    vi.setSystemTime(Date.now() + PICKUP_CACHE_TTL_MS - 1000);
    // Same code, other spelling: same cache entry.
    expect(await s.search({ postalCode: '1000001' })).toEqual([point('A'), point('B')]);
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
    expect(PICKUP_CACHE_TTL_MS).toBe(10 * 60 * 1000);

    vi.setSystemTime(Date.now() + 2000);
    await s.search({ postalCode: '1000-001' });
    expect(client.searchPudo).toHaveBeenCalledTimes(2);
  });

  it('the cache does not bypass the availability check', async () => {
    await setup().search({ postalCode: '1000-001' });
    expect(
      await codeOf(setup({ runtime: runtime({ pickup: { active: false } }) }).search({ postalCode: '1000-001' }))
    ).toBe('PICKUP_NOT_AVAILABLE');
  });

  it('an empty result is cached and is not an error', async () => {
    client.searchPudo.mockResolvedValue([]);
    const s = setup();
    expect(await s.search({ postalCode: '1000-001' })).toEqual([]);
    expect(await s.search({ postalCode: '1000-001' })).toEqual([]);
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
  });

  it('a client failure is PICKUP_SEARCH_FAILED, logged with the code only, and not cached', async () => {
    client.searchPudo.mockRejectedValueOnce(new EcommerceCarrierError('PICKUP_SEARCH_FAILED', 'x'));
    const s = setup();
    expect(await codeOf(s.search({ postalCode: '1000-001' }))).toBe('PICKUP_SEARCH_FAILED');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('PICKUP_SEARCH_FAILED');
    expect(message).not.toContain('1000');
    expect(message).not.toContain('KEY');
    expect(await s.search({ postalCode: '1000-001' })).toHaveLength(2);
  });

  it('any other client error is mapped to PICKUP_SEARCH_FAILED', async () => {
    client.searchPudo.mockRejectedValueOnce(new Error('boom KEY'));
    expect(await codeOf(setup().search({ postalCode: '1000-001' }))).toBe('PICKUP_SEARCH_FAILED');
    expect(String(warn.mock.calls[0][0])).not.toContain('KEY');
  });
});

describe('EcommercePickupPointService.findPoint', () => {
  it('finds a point from the cache without a new search', async () => {
    const s = setup();
    await s.search({ postalCode: '1000-001' });
    expect(await s.findPoint('1000001', 'B')).toEqual(point('B'));
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
  });

  it('searches when the cache has nothing, and returns null for an unknown id', async () => {
    const s = setup();
    expect(await s.findPoint('1000-001', 'A')).toEqual(point('A'));
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
    expect(await s.findPoint('1000-001', 'Z')).toBeNull();
    expect(client.searchPudo).toHaveBeenCalledTimes(1);
  });

  it('propagates the search errors', async () => {
    client.searchPudo.mockRejectedValueOnce(new Error('down'));
    expect(await codeOf(setup().findPoint('1000-001', 'A'))).toBe('PICKUP_SEARCH_FAILED');
    expect(await codeOf(setup().findPoint('x', 'A'))).toBe('INVALID_POSTAL_CODE');
  });
});

describe('pickup method kinds (store pickup ruling 2)', () => {
  it('isDpdPickup is DPD Pickup only; isStorePickup is Store pickup only; isPickupMethod is either', async () => {
    const { isDpdPickup, isStorePickup, isPickupMethod } = await import(
      '../../../server/src/services/modules/ecommerce/domain/pickupPoints'
    );
    const cases: [string, string, boolean, boolean][] = [
      ['dpd-portugal', 'PICKUP', true, false],
      ['store-pickup', 'STORE', false, true],
      ['dpd-portugal', 'EXPRESS', false, false],
      ['store-pickup', 'PICKUP', false, false],
      ['manual', '1', false, false],
    ];
    for (const [providerId, serviceId, dpd, store] of cases) {
      expect(isDpdPickup(providerId, serviceId)).toBe(dpd);
      expect(isStorePickup(providerId, serviceId)).toBe(store);
      expect(isPickupMethod(providerId, serviceId)).toBe(dpd || store);
    }
  });
});
