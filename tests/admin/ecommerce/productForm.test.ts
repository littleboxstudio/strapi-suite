import { describe, it, expect } from 'vitest';
import {
  applyTranslations,
  buildProductInput,
  buildTranslationRequest,
  emptyProductForm,
  extractFieldErrors,
  hasErrorsUnder,
  isBlankHtml,
  productFormFromDetail,
  scopedErrors,
  toErrorMap,
  validateProductForm,
  type FormVariant,
  type ProductForm,
} from '../../../admin/src/ecommerce/utils/productForm';
import type { ProductDetail } from '../../../admin/src/ecommerce/types';

const LOCALES = ['en', 'pt'];

const variant = (over: Partial<FormVariant> = {}): FormVariant => ({
  key: 'k1',
  images: [],
  sku: 'SKU-1',
  price: 2990,
  tax: 23,
  stock: 3,
  weight: 0,
  width: 0,
  height: 0,
  depth: 0,
  active: true,
  translations: { en: { option: 'Black' }, pt: { option: '' } },
  ...over,
});

const form = (over: Partial<ProductForm> = {}): ProductForm => ({
  active: true,
  translations: {
    en: { name: 'Shirt', shortDescription: 'Short', description: '<p>Nice</p>' },
    pt: { name: '', shortDescription: '', description: '' },
  },
  variants: [variant()],
  ...over,
});

describe('emptyProductForm', () => {
  it('has a blank translation per locale and no variants', () => {
    expect(emptyProductForm(LOCALES)).toEqual({
      active: true,
      translations: {
        en: { name: '', shortDescription: '', description: '' },
        pt: { name: '', shortDescription: '', description: '' },
      },
      variants: [],
    });
  });
});

describe('productFormFromDetail', () => {
  it('fills missing locales and keeps ids, slugs and images', () => {
    const detail: ProductDetail = {
      id: 7,
      active: false,
      images: [],
      translations: { en: { name: 'Shirt', slug: 'shirt', description: '<p>x</p>' } },
      variants: [
        {
          id: 3,
          sku: 'A',
          price: 100,
          tax: 23,
          stock: 1,
          weight: 0,
          width: 0,
          height: 0,
          depth: 0,
          active: true,
          translations: { en: { option: 'Black' } },
          images: [],
        },
      ],
    };
    const result = productFormFromDetail(detail, LOCALES);
    expect(result.active).toBe(false);
    expect(result.translations.en).toEqual({
      name: 'Shirt',
      slug: 'shirt',
      shortDescription: '',
      description: '<p>x</p>',
    });
    expect(result.translations.pt).toEqual({ name: '', shortDescription: '', description: '' });
    expect(result.variants[0].id).toBe(3);
    expect(result.variants[0].key).toBe('id-3');
    expect(result.variants[0].translations).toEqual({
      en: { option: 'Black' },
      pt: { option: '' },
    });
  });
});

describe('buildProductInput', () => {
  it('strips form-only fields (key, images, slug)', () => {
    const f = form();
    f.translations.en.slug = 'shirt';
    f.variants[0].id = 9;
    const input = buildProductInput(f);
    expect(input.translations.en).toEqual({
      name: 'Shirt',
      shortDescription: 'Short',
      description: '<p>Nice</p>',
    });
    expect(input.variants[0]).toEqual({
      id: 9,
      sku: 'SKU-1',
      price: 2990,
      tax: 23,
      stock: 3,
      weight: 0,
      width: 0,
      height: 0,
      depth: 0,
      active: true,
      translations: { en: { option: 'Black' }, pt: { option: '' } },
    });
    expect('key' in input.variants[0]).toBe(false);
  });
});

describe('isBlankHtml', () => {
  it('treats empty paragraphs and whitespace as blank', () => {
    expect(isBlankHtml('')).toBe(true);
    expect(isBlankHtml('<p></p>')).toBe(true);
    expect(isBlankHtml('<p> <br></p>')).toBe(true);
    expect(isBlankHtml('<p><strong>a</strong></p>')).toBe(false);
  });
});

describe('validateProductForm', () => {
  it('accepts a complete product', () => {
    expect(validateProductForm(form(), 'en')).toEqual([]);
  });
  it('requires at least one variant', () => {
    expect(validateProductForm(form({ variants: [] }), 'en')).toContainEqual({
      path: 'variants',
      code: 'min_variants',
    });
  });
  it('requires name and description in the default locale only', () => {
    const f = form();
    f.translations.en = { name: ' ', shortDescription: '', description: '<p></p>' };
    expect(validateProductForm(f, 'en')).toEqual([
      { path: 'translations.en.name', code: 'required' },
      { path: 'translations.en.description', code: 'required' },
    ]);
  });
});

describe('error mapping', () => {
  const errors = [
    { path: 'translations.en.name', code: 'required' as const },
    { path: 'variants.1.sku', code: 'duplicate_sku' as const },
    { path: 'variants.1.translations.en.option', code: 'required' as const },
    { path: 'variants.1.sku', code: 'required' as const },
  ];

  it('keeps the first code per path', () => {
    expect(toErrorMap(errors)).toEqual({
      'translations.en.name': 'required',
      'variants.1.sku': 'duplicate_sku',
      'variants.1.translations.en.option': 'required',
    });
  });

  it('scopes errors to a variant', () => {
    const map = toErrorMap(errors);
    expect(scopedErrors(map, 'variants.1')).toEqual({
      sku: 'duplicate_sku',
      'translations.en.option': 'required',
    });
    expect(scopedErrors(map, 'variants.0')).toEqual({});
  });

  it('detects errors under a prefix without matching siblings like variants.10', () => {
    const map = toErrorMap([{ path: 'variants.10.sku', code: 'required' }]);
    expect(hasErrorsUnder(map, 'variants.1')).toBe(false);
    expect(hasErrorsUnder(map, 'variants.10')).toBe(true);
  });

  it('extracts field errors from a fetch client error', () => {
    const err = {
      response: {
        data: {
          error: {
            status: 400,
            name: 'BadRequestError',
            message: 'Invalid product',
            details: { errors },
          },
        },
      },
    };
    expect(extractFieldErrors(err)).toEqual(errors);
    expect(extractFieldErrors(new Error('network'))).toBeNull();
    expect(extractFieldErrors({ response: { data: { error: { details: {} } } } })).toBeNull();
  });
});

describe('AI translation', () => {
  it('asks only for locales that have blank fields, sending default-locale strings', () => {
    const f = form({
      variants: [
        variant(),
        variant({ key: 'k2', translations: { en: { option: 'White' }, pt: { option: 'Branco' } } }),
      ],
    });
    expect(buildTranslationRequest(f, 'en', LOCALES)).toEqual({
      sourceLocale: 'en',
      targetLocales: ['pt'],
      strings: {
        name: 'Shirt',
        shortDescription: 'Short',
        description: '<p>Nice</p>',
        'variants.0.option': 'Black',
        'variants.1.option': 'White',
      },
    });
  });

  it('skips blank source strings and fully translated locales', () => {
    const f = form();
    f.translations.en.shortDescription = '';
    f.translations.pt = { name: 'Camisa', shortDescription: '', description: '<p>Boa</p>' };
    f.variants[0].translations.pt.option = 'Preto';
    expect(buildTranslationRequest(f, 'en', LOCALES)).toBeNull();
  });

  it('returns null when there is nothing to translate from', () => {
    expect(buildTranslationRequest(emptyProductForm(LOCALES), 'en', LOCALES)).toBeNull();
  });

  it('fills only blank fields, never overwriting', () => {
    const f = form();
    f.translations.pt.name = 'Camisola';
    const result = applyTranslations(f, {
      pt: {
        name: 'Camisa',
        shortDescription: 'Curta',
        description: '<p>Boa</p>',
        'variants.0.option': 'Preto',
        'variants.5.option': 'Ignored',
      },
    });
    expect(result.translations.pt).toEqual({
      name: 'Camisola',
      shortDescription: 'Curta',
      description: '<p>Boa</p>',
    });
    expect(result.variants[0].translations.pt.option).toBe('Preto');
    expect(f.translations.pt.shortDescription).toBe('');
  });
});
