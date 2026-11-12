import { describe, expect, it } from 'vitest';
import {
  addAllMarkets,
  addMarket,
  filterMarketsByName,
  marketRows,
  removeMarket,
} from '../../../admin/src/ecommerce/utils/markets';

describe('markets list helpers', () => {
  it('addMarket appends a new country and ignores blanks and duplicates', () => {
    expect(addMarket(['PT'], 'ES')).toEqual(['PT', 'ES']);
    const list = ['PT'];
    expect(addMarket(list, 'PT')).toBe(list);
    expect(addMarket(list, '')).toBe(list);
  });

  it('addAllMarkets adds only the missing countries after the existing ones', () => {
    expect(addAllMarkets(['ES'], ['PT', 'ES', 'FR'])).toEqual(['ES', 'PT', 'FR']);
    const list = ['PT', 'ES'];
    expect(addAllMarkets(list, ['ES', 'PT'])).toBe(list);
  });

  it('removeMarket removes the country', () => {
    expect(removeMarket(['PT', 'ES', 'FR'], 'ES')).toEqual(['PT', 'FR']);
    expect(removeMarket(['PT'], 'ES')).toEqual(['PT']);
  });

  it('marketRows names and sorts the countries, falling back to the code', () => {
    const countries = [
      { code: 'PT', name: 'Portugal' },
      { code: 'ES', name: 'Espanha' },
    ];
    expect(marketRows(['PT', 'ES', 'XK'], countries, 'pt')).toEqual([
      { code: 'ES', name: 'Espanha' },
      { code: 'PT', name: 'Portugal' },
      { code: 'XK', name: 'XK' },
    ]);
  });
});

describe('filterMarketsByName', () => {
  const names: Record<string, string> = { PT: 'Portugal', ES: 'Espanha', AT: 'Áustria' };
  const nameOf = (code: string) => names[code];

  it('keeps the markets whose name contains the text, ignoring case and accents', () => {
    expect(filterMarketsByName(['PT', 'ES', 'AT'], nameOf, 'ESP')).toEqual(['ES']);
    expect(filterMarketsByName(['PT', 'ES', 'AT'], nameOf, 'austria')).toEqual(['AT']);
    expect(filterMarketsByName(['PT', 'ES', 'AT'], nameOf, 'a')).toEqual(['PT', 'ES', 'AT']);
    expect(filterMarketsByName(['PT', 'ES'], nameOf, 'x')).toEqual([]);
  });

  it('returns every market for a blank search', () => {
    const codes = ['PT', 'ES'];
    expect(filterMarketsByName(codes, nameOf, '  ')).toBe(codes);
  });
});
