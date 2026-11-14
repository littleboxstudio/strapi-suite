import { describe, it, expect } from 'vitest';
import {
  ISLANDS_MARKET,
  isMarketCode,
  marketCountry,
  marketOf,
} from '../../../../server/src/services/modules/ecommerce/domain/markets';

describe('marketOf', () => {
  it('a PT island postcode is PT-ISL when the store sells there', () => {
    expect(ISLANDS_MARKET).toBe('PT-ISL');
    expect(marketOf('PT', '9500-123', ['PT', 'PT-ISL'])).toBe('PT-ISL');
    expect(marketOf('PT', ' 9000001 ', ['PT-ISL'])).toBe('PT-ISL');
  });

  it('without PT-ISL in the store markets the islands stay PT', () => {
    expect(marketOf('PT', '9500-123', ['PT'])).toBe('PT');
    expect(marketOf('PT', '9500-123', [])).toBe('PT');
  });

  it('a mainland postcode, a missing one or another country keep the country', () => {
    expect(marketOf('PT', '1000-001', ['PT', 'PT-ISL'])).toBe('PT');
    expect(marketOf('PT', null, ['PT', 'PT-ISL'])).toBe('PT');
    expect(marketOf('PT', undefined, ['PT', 'PT-ISL'])).toBe('PT');
    expect(marketOf('PT', '', ['PT', 'PT-ISL'])).toBe('PT');
    expect(marketOf('ES', '9000', ['ES', 'PT-ISL'])).toBe('ES');
  });
});

describe('marketCountry', () => {
  it('PT-ISL is in PT; a country market is itself', () => {
    expect(marketCountry('PT-ISL')).toBe('PT');
    expect(marketCountry('PT')).toBe('PT');
    expect(marketCountry('ES')).toBe('ES');
  });
});

describe('isMarketCode', () => {
  it('accepts ISO countries and PT-ISL only', () => {
    expect(isMarketCode('PT')).toBe(true);
    expect(isMarketCode('ES')).toBe(true);
    expect(isMarketCode('PT-ISL')).toBe(true);
    for (const bad of ['pt', 'XX-ISL', 'ES-ISL', 'PRT', 'ZZ', 'EU', '']) expect(isMarketCode(bad)).toBe(false);
  });
});
