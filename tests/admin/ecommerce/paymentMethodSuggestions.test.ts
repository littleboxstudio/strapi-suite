import { describe, it, expect } from 'vitest';
import { filterPaymentMethodSuggestions } from '../../../admin/src/ecommerce/utils/paymentMethodSuggestions';

const names = ['Cash', 'MB Way', 'Multibanco', 'Transferência'];

describe('filterPaymentMethodSuggestions', () => {
  it('returns every name for an empty or blank text', () => {
    expect(filterPaymentMethodSuggestions(names, '')).toEqual(names);
    expect(filterPaymentMethodSuggestions(names, '   ')).toEqual(names);
  });

  it('is a case-insensitive contains', () => {
    expect(filterPaymentMethodSuggestions(names, 'mb')).toEqual(['MB Way']);
    expect(filterPaymentMethodSuggestions(names, 'M')).toEqual(['MB Way', 'Multibanco']);
    expect(filterPaymentMethodSuggestions(names, 'WAY')).toEqual(['MB Way']);
    expect(filterPaymentMethodSuggestions(names, 'ência')).toEqual(['Transferência']);
  });

  it('ignores surrounding whitespace in the typed text', () => {
    expect(filterPaymentMethodSuggestions(names, '  cash ')).toEqual(['Cash']);
  });

  it('returns nothing when no name matches', () => {
    expect(filterPaymentMethodSuggestions(names, 'paypal')).toEqual([]);
  });
});

describe('withoutPaymentMethodSuggestion / restorePaymentMethodSuggestion', () => {
  it('removes one name and puts it back at its sorted place', async () => {
    const { withoutPaymentMethodSuggestion, restorePaymentMethodSuggestion } = await import(
      '../../../admin/src/ecommerce/utils/paymentMethodSuggestions'
    );
    const removed = withoutPaymentMethodSuggestion(names, 'MB Way');
    expect(removed).toEqual(['Cash', 'Multibanco', 'Transferência']);
    expect(restorePaymentMethodSuggestion(removed, 'MB Way')).toEqual(names);
    expect(restorePaymentMethodSuggestion(names, 'MB Way')).toEqual(names);
  });
});
