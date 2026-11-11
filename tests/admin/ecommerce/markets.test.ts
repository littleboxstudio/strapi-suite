import { describe, expect, it } from 'vitest';
import {
  addAllMarkets,
  addMarket,
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
