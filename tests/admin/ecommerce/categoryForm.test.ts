import { describe, it, expect } from 'vitest';
import { followNameSlug, validateCategoryTexts } from '../../../admin/src/ecommerce/utils/categoryForm';

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

describe('followNameSlug', () => {
  it('follows the name while the slug is empty or matches the previous name', () => {
    expect(followNameSlug('', '', 'Camisas de Linho')).toBe('camisas-de-linho');
    expect(followNameSlug('Camisas', 'camisas', 'Camisas Ação')).toBe('camisas-acao');
  });

  it('keeps a slug edited by hand', () => {
    expect(followNameSlug('Camisas', 'shirts', 'Camisas de linho')).toBe('shirts');
  });

  it('empties the slug when the name is cleared', () => {
    expect(followNameSlug('Camisas', 'camisas', '')).toBe('');
  });
});
