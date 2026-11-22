import { describe, it, expect } from 'vitest';
import { validateCategoryTexts } from '../../../admin/src/ecommerce/utils/categoryForm';

const tr = (over: Partial<Record<'name' | 'slug' | 'description' | 'seoTitle' | 'seoDescription', string>> = {}) => ({
  name: '',
  slug: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
  ...over,
});

describe('validateCategoryTexts', () => {
  it('requires the default locale name', () => {
    expect(validateCategoryTexts({ en: tr(), pt: tr() }, 'en')).toEqual({ 'translations.en.name': 'required' });
  });

  it('requires a name in another locale that has any other text (it would be dropped)', () => {
    for (const field of ['slug', 'description', 'seoTitle', 'seoDescription'] as const) {
      expect(validateCategoryTexts({ en: tr({ name: 'Shirts' }), pt: tr({ [field]: 'x' }) }, 'en')).toEqual({
        'translations.pt.name': 'required',
      });
    }
  });

  it('accepts an empty other locale and a whitespace-only text as empty', () => {
    expect(validateCategoryTexts({ en: tr({ name: 'Shirts' }), pt: tr({ seoTitle: '   ' }) }, 'en')).toEqual({});
  });

  it('accepts another locale with a name', () => {
    expect(validateCategoryTexts({ en: tr({ name: 'Shirts' }), pt: tr({ name: 'Camisas', slug: 'camisas' }) }, 'en')).toEqual({});
  });
});
