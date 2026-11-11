import { describe, it, expect } from 'vitest';
import {
  draftToVariant,
  emptyVariantDraft,
  variantToDraft,
} from '../../../admin/src/ecommerce/utils/variantDraft';
import type { FormVariant } from '../../../admin/src/ecommerce/utils/productForm';

const LOCALES = ['en', 'pt'];

const saved: FormVariant = {
  id: 4,
  key: 'id-4',
  images: [],
  sku: 'TS-BLK',
  price: 2990,
  tax: 13,
  stock: 5,
  weight: 0.25,
  width: 10,
  height: 0,
  depth: 0,
  active: false,
  translations: { en: { option: 'Black' } },
};

describe('variant drafts', () => {
  it('starts a new draft with sensible defaults', () => {
    expect(emptyVariantDraft(LOCALES, 'new-1')).toEqual({
      key: 'new-1',
      images: [],
      active: true,
      sku: '',
      stock: '0',
      price: '',
      taxChoice: '23',
      taxOther: '',
      weight: '0',
      width: '0',
      height: '0',
      depth: '0',
      options: { en: '', pt: '' },
    });
  });

  it('converts a saved variant into strings (price in the ui locale)', () => {
    const draft = variantToDraft(saved, LOCALES, 'pt-PT');
    expect(draft).toMatchObject({
      id: 4,
      key: 'id-4',
      active: false,
      sku: 'TS-BLK',
      stock: '5',
      price: '29,90',
      taxChoice: '13',
      taxOther: '',
      weight: '0.25',
      width: '10',
      options: { en: 'Black', pt: '' },
    });
    expect(variantToDraft(saved, LOCALES, 'en').price).toBe('29.90');
  });

  it('uses "other" for a tax outside the presets', () => {
    const draft = variantToDraft({ ...saved, tax: 5.5 }, LOCALES, 'en');
    expect(draft.taxChoice).toBe('other');
    expect(draft.taxOther).toBe('5.5');
  });

  it('round-trips a valid draft back into a variant', () => {
    const { variant, errors } = draftToVariant(variantToDraft(saved, LOCALES, 'pt-PT'), 'en');
    expect(errors).toEqual({});
    expect(variant).toEqual({
      ...saved,
      translations: { en: { option: 'Black' }, pt: { option: '' } },
    });
  });

  it('parses decimals with a comma and the "other" tax', () => {
    const draft = {
      ...emptyVariantDraft(LOCALES, 'new-1'),
      sku: ' A ',
      price: '1 299,5',
      taxChoice: 'other',
      taxOther: '5,5',
      weight: '1,25',
      options: { en: 'M', pt: '' },
    };
    const { variant, errors } = draftToVariant(draft, 'en');
    expect(errors).toEqual({});
    expect(variant).toMatchObject({ sku: 'A', price: 129950, tax: 5.5, weight: 1.25, stock: 0 });
  });

  it('reports field errors with server-compatible paths', () => {
    const draft = {
      ...emptyVariantDraft(LOCALES, 'new-1'),
      stock: '1.5',
      price: 'abc',
      taxChoice: 'other',
      taxOther: '101',
      width: '-1',
    };
    const { variant, errors } = draftToVariant(draft, 'en');
    expect(variant).toBeUndefined();
    expect(errors).toEqual({
      'translations.en.option': 'required',
      sku: 'required',
      stock: 'invalid_number',
      price: 'invalid_number',
      tax: 'out_of_range',
      width: 'invalid_number',
    });
  });

  it('requires a price', () => {
    const draft = { ...emptyVariantDraft(LOCALES, 'k'), sku: 'A', options: { en: 'M', pt: '' } };
    expect(draftToVariant(draft, 'en').errors).toEqual({ price: 'required' });
  });
});
