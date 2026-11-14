import { describe, it, expect } from 'vitest';
import {
  DPD_SERVICE_DEFAULTS,
  DpdServices,
  dpdActivationIssues,
  dpdServedMarkets,
  normalizeDpdServices,
  readDpdServices,
} from '../../../../server/src/services/modules/ecommerce/domain/dpdServices';

const MARKETS = new Set(['PT', 'PT-ISL', 'ES']);
const RATE = [{ upTo: null, price: 500 }];

const services = (over: Partial<Record<'EXPRESS' | 'PICKUP', Partial<DpdServices['EXPRESS']>>> = {}): DpdServices => ({
  EXPRESS: { ...DPD_SERVICE_DEFAULTS.EXPRESS, ...over.EXPRESS },
  PICKUP: { ...DPD_SERVICE_DEFAULTS.PICKUP, ...over.PICKUP },
});

describe('DPD_SERVICE_DEFAULTS', () => {
  it('has both services inactive, default names, 23% VAT and no rates', () => {
    expect(DPD_SERVICE_DEFAULTS).toEqual({
      EXPRESS: { active: false, name: { en: 'DPD Express', pt: 'DPD Express' }, tax: 23, rates: {} },
      PICKUP: { active: false, name: { en: 'DPD Pickup', pt: 'DPD Pickup' }, tax: 23, rates: {} },
    });
  });
});

describe('normalizeDpdServices', () => {
  it('normalizes both services, falling back to the defaults', () => {
    const errors: any[] = [];
    const out = normalizeDpdServices(
      { EXPRESS: { active: true, name: { en: ' Fast ', pt: '' }, tax: 6, rates: { pt: RATE } } },
      MARKETS,
      errors
    );
    expect(errors).toEqual([]);
    expect(out.EXPRESS).toEqual({ active: true, name: { en: 'Fast' }, tax: 6, rates: { PT: RATE } });
    expect(out.PICKUP).toEqual(DPD_SERVICE_DEFAULTS.PICKUP);
  });

  it('a service without any name gets the default names', () => {
    const errors: any[] = [];
    const out = normalizeDpdServices({ PICKUP: { active: true, name: { en: '  ' } } }, MARKETS, errors);
    expect(errors).toEqual([]);
    expect(out.PICKUP.name).toEqual({ en: 'DPD Pickup', pt: 'DPD Pickup' });
  });

  it('rates for a non-store market fail with the manual-method code, under the service path', () => {
    const errors: any[] = [];
    normalizeDpdServices({ PICKUP: { rates: { FR: RATE } } }, MARKETS, errors);
    expect(errors).toEqual([{ path: 'services.PICKUP.rates.FR', code: 'invalid_country' }]);
  });

  it('accepts PT-ISL rates when it is a store market', () => {
    const errors: any[] = [];
    const out = normalizeDpdServices({ EXPRESS: { rates: { 'PT-ISL': RATE } } }, MARKETS, errors);
    expect(errors).toEqual([]);
    expect(out.EXPRESS.rates).toEqual({ 'PT-ISL': RATE });
  });

  it('validates brackets and tax', () => {
    const errors: any[] = [];
    normalizeDpdServices(
      { EXPRESS: { tax: 120, rates: { PT: [{ upTo: 1, price: -1 }] } }, PICKUP: { tax: 'x' } },
      MARKETS,
      errors
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { path: 'services.EXPRESS.tax', code: 'out_of_range' },
        { path: 'services.EXPRESS.rates.PT.0.price', code: 'out_of_range' },
        { path: 'services.PICKUP.tax', code: 'invalid_number' },
      ])
    );
  });

  it('rejects a non-object input', () => {
    const errors: any[] = [];
    normalizeDpdServices('nope', MARKETS, errors);
    expect(errors).toEqual([{ path: 'services', code: 'invalid_number' }]);
  });
});

describe('readDpdServices', () => {
  it('reads stored services leniently', () => {
    expect(readDpdServices(undefined)).toEqual(DPD_SERVICE_DEFAULTS);
    const read = readDpdServices({ EXPRESS: { active: true, name: { en: 'X' }, tax: 6, rates: { PT: RATE, bad: 1 } } });
    expect(read.EXPRESS).toEqual({ active: true, name: { en: 'X' }, tax: 6, rates: { PT: RATE } });
    expect(read.PICKUP).toEqual(DPD_SERVICE_DEFAULTS.PICKUP);
  });
});

describe('dpdActivationIssues', () => {
  const config = { accountHome: 'H1', accountShop: 'S1' };
  const has = () => true;

  it('needs an active service', () => {
    expect(dpdActivationIssues(services(), config, has)).toEqual([{ path: 'services', code: 'NO_ACTIVE_SERVICE' }]);
  });

  it('EXPRESS needs accountHome', () => {
    expect(dpdActivationIssues(services({ EXPRESS: { active: true } }), {}, has)).toEqual([
      { path: 'config.accountHome', code: 'required' },
    ]);
    expect(dpdActivationIssues(services({ EXPRESS: { active: true } }), config, () => false)).toEqual([]);
  });

  it('PICKUP needs accountShop and pickupKey', () => {
    expect(dpdActivationIssues(services({ PICKUP: { active: true } }), { accountShop: ' ' }, () => false)).toEqual([
      { path: 'config.accountShop', code: 'required' },
      { path: 'secrets.pickupKey', code: 'required' },
    ]);
    expect(dpdActivationIssues(services({ PICKUP: { active: true } }), config, (k) => k === 'pickupKey')).toEqual([]);
  });
});

describe('dpdServedMarkets', () => {
  it('is the union of the active services rate markets, limited to the store markets', () => {
    const s = services({
      EXPRESS: { active: true, rates: { PT: RATE, ES: RATE } },
      PICKUP: { active: true, rates: { PT: RATE, 'PT-ISL': RATE } },
    });
    expect(dpdServedMarkets(s, ['PT', 'PT-ISL'])).toEqual(['PT', 'PT-ISL']);
  });

  it('ignores inactive services', () => {
    const s = services({ EXPRESS: { active: false, rates: { PT: RATE } }, PICKUP: { active: true, rates: { ES: RATE } } });
    expect(dpdServedMarkets(s, ['PT', 'ES'])).toEqual(['ES']);
  });
});
