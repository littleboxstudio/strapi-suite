import { describe, it, expect } from 'vitest';
import {
  draftToVariant,
  emptyVariantDraft,
  variantToDraft,
  withAdjustmentKey,
  mintUuid,
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
      savedStock: 5,
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

  describe('stock', () => {
    const named = { sku: 'A', price: '1', options: { en: 'M', pt: '' } };

    it('accepts a negative initial stock for a new variant', () => {
      const draft = { ...emptyVariantDraft(LOCALES, 'k'), ...named, stock: '-2' };
      expect(draftToVariant(draft, 'en').variant).toMatchObject({ stock: -2 });
      expect(draftToVariant(draft, 'en').variant).not.toHaveProperty('stockAdjustment');
    });

    it('sends the typed current stock of an existing variant as a difference from the saved one', () => {
      const down = { ...variantToDraft(saved, LOCALES, 'en'), stock: ' 2 ' };
      expect(draftToVariant(down, 'en').variant).toMatchObject({
        stock: 5,
        stockAdjustment: -3,
        stockExpected: 5,
      });
      const up = { ...variantToDraft(saved, LOCALES, 'en'), stock: '10' };
      expect(draftToVariant(up, 'en').variant).toMatchObject({ stock: 5, stockAdjustment: 5, stockExpected: 5 });
      const negative = { ...variantToDraft(saved, LOCALES, 'en'), stock: '-1' };
      expect(draftToVariant(negative, 'en').variant).toMatchObject({ stockAdjustment: -6 });
    });

    it('sends no adjustment when the stock is unchanged', () => {
      const draft = variantToDraft(saved, LOCALES, 'en');
      const variant = draftToVariant(draft, 'en').variant;
      expect(variant).not.toHaveProperty('stockAdjustment');
      expect(variant).not.toHaveProperty('stockExpected');
    });

    it('rejects an empty or non-integer stock', () => {
      expect(draftToVariant({ ...variantToDraft(saved, LOCALES, 'en'), stock: '' }, 'en').errors).toEqual({
        stock: 'required',
      });
      for (const stock of ['1.5', 'abc', '--1']) {
        const draft = { ...variantToDraft(saved, LOCALES, 'en'), stock };
        expect(draftToVariant(draft, 'en').errors).toEqual({ stock: 'invalid_number' });
      }
    });

    it('reopens a variant showing the stock its pending change will give', () => {
      const pending = variantToDraft({ ...saved, stockAdjustment: 4 }, LOCALES, 'en');
      expect(pending).toMatchObject({ stock: '9', savedStock: 5 });
      // confirming it again keeps the same difference
      expect(draftToVariant(pending, 'en').variant).toMatchObject({ stockAdjustment: 4, stockExpected: 5 });
    });

    it('mints an idempotency key per confirmed adjustment', () => {
      const mint = () => 'new-key';
      expect(withAdjustmentKey({ ...saved, stockAdjustment: 3 }, saved, mint)).toMatchObject({
        stockAdjustment: 3,
        stockAdjustmentKey: 'new-key',
      });
      // Reconfirming the same pending adjustment keeps its key.
      const pending = { ...saved, stockAdjustment: 3, stockAdjustmentKey: 'k1' };
      expect(withAdjustmentKey({ ...saved, stockAdjustment: 3 }, pending, mint).stockAdjustmentKey).toBe('k1');
      // A changed amount is a new adjustment.
      expect(withAdjustmentKey({ ...saved, stockAdjustment: 4 }, pending, mint).stockAdjustmentKey).toBe(
        'new-key'
      );
      // No adjustment, no key.
      expect(withAdjustmentKey(saved, pending, mint)).not.toHaveProperty('stockAdjustmentKey');
    });

    it('mints v4 uuids even without crypto.randomUUID', () => {
      const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(mintUuid()).toMatch(re);
      const original = crypto.randomUUID;
      try {
        (crypto as any).randomUUID = undefined;
        expect(mintUuid()).toMatch(re);
      } finally {
        (crypto as any).randomUUID = original;
      }
    });
  });
});
