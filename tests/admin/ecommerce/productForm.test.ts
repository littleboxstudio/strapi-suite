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
  addTag,
  emptyOrganization,
  organizationError,
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
  organization: emptyOrganization(),
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
      organization: {
        category: null,
        tags: [],
        collections: [],
        automatedCollections: [],
      },
    });
  });
});

describe('productFormFromDetail', () => {
  it('fills missing locales and keeps ids, slugs and images', () => {
    const detail: ProductDetail = {
      id: 7,
      active: false,
      deletable: true,
      images: [],
      translations: { en: { name: 'Shirt', slug: 'shirt', description: '<p>x</p>' } },
      categoryId: null,
      categoryPath: [],
      tags: [],
      collections: [],
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
          compareAtPrice: null,
          translations: { en: { option: 'Black' } },
          images: [],
          deletable: false,
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
    // A variant in some order keeps the flag, so its trash button explains instead of removing.
    expect(result.variants[0].deletable).toBe(false);
    expect(result.variants[0].translations).toEqual({
      en: { option: 'Black' },
      pt: { option: '' },
    });
    expect(result.variants[0].compareAtPrice).toBeNull();
    expect(result.organization).toEqual(emptyOrganization());
  });

  it('reads the organization fields and splits manual from automated collections', () => {
    const detail = {
      id: 7,
      active: true,
      deletable: true,
      images: [],
      translations: { en: { name: 'Shirt', slug: 'shirt', description: '<p>x</p>' } },
      categoryId: 3,
      categoryPath: [
        { id: 1, name: 'Clothing' },
        { id: 2, name: 'Shirts' },
        { id: 3, name: 'Linen' },
      ],
      tags: [
        { id: 8, name: 'summer' },
        { id: 9, name: 'linen' },
      ],
      collections: [
        { id: 11, title: 'Featured', type: 'MANUAL' },
        { id: 12, title: 'On sale', type: 'AUTOMATED' },
      ],
      variants: [],
    } as ProductDetail;
    expect(productFormFromDetail(detail, LOCALES).organization).toEqual({
      category: { id: 3, path: 'Clothing > Shirts > Linen' },
      tags: [
        { id: 8, name: 'summer' },
        { id: 9, name: 'linen' },
      ],
      collections: [{ id: 11, title: 'Featured' }],
      automatedCollections: [{ id: 12, title: 'On sale' }],
    });
  });
});

describe('buildProductInput', () => {
  it('strips form-only fields (key, images, slug, deletable)', () => {
    const f = form();
    f.translations.en.slug = 'shirt';
    f.variants[0].id = 9;
    f.variants[0].deletable = false;
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
    expect('deletable' in input.variants[0]).toBe(false);
  });

  it('always sends every organization field explicitly (empty = cleared)', () => {
    const input = buildProductInput(form());
    expect(input).toMatchObject({
      categoryId: null,
      tagIds: [],
      tagNames: [],
      collectionIds: [],
    });
  });

  it('sends chosen organization values, existing tags as ids and new ones as names', () => {
    const input = buildProductInput(
      form({
        organization: {
          category: { id: 3, path: 'A > B' },
          tags: [{ id: 8, name: 'summer' }, { name: 'new one' }, { id: 9, name: 'linen' }],
          collections: [{ id: 11, title: 'Featured' }],
          automatedCollections: [{ id: 12, title: 'On sale' }],
        },
      })
    );
    expect(input).toMatchObject({
      categoryId: 3,
      tagIds: [8, 9],
      tagNames: ['new one'],
      // Automated memberships are computed by the server, never sent.
      collectionIds: [11],
    });
  });

  it('keeps the compare-at price of the variants', () => {
    const input = buildProductInput(form({ variants: [variant({ compareAtPrice: 3990 })] }));
    expect(input.variants[0].compareAtPrice).toBe(3990);
  });

  it('sends a pending stock adjustment of an existing variant', () => {
    const input = buildProductInput(form({ variants: [variant({ id: 9, stockAdjustment: -4 })] }));
    expect(input.variants[0]).toMatchObject({ id: 9, stock: 3, stockAdjustment: -4 });
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

describe('tags', () => {
  const suggestions = [
    { id: 8, name: 'Summer' },
    { id: 9, name: 'Linen' },
  ];

  it('adds a typed name as a new tag, trimmed', () => {
    expect(addTag([], '  Cotton ', [])).toEqual([{ name: 'Cotton' }]);
  });

  it('uses the existing tag when the name matches a suggestion (any case)', () => {
    expect(addTag([], 'summer', suggestions)).toEqual([{ id: 8, name: 'Summer' }]);
  });

  it('ignores blanks and names already chosen (any case, any spacing)', () => {
    const chosen = [{ id: 8, name: 'Summer' }, { name: 'Cotton' }];
    expect(addTag(chosen, '   ', suggestions)).toBe(chosen);
    expect(addTag(chosen, 'SUMMER', suggestions)).toBe(chosen);
    expect(addTag(chosen, ' cotton  ', suggestions)).toBe(chosen);
    expect(addTag(chosen, 'Big  Cotton', [])).toEqual([...chosen, { name: 'Big Cotton' }]);
  });

  it('adds a picked suggestion by id', () => {
    expect(addTag([{ name: 'x' }], { id: 9, name: 'Linen' }, [])).toEqual([
      { name: 'x' },
      { id: 9, name: 'Linen' },
    ]);
    const chosen = [{ id: 9, name: 'Linen' }];
    expect(addTag(chosen, { id: 9, name: 'Linen' }, [])).toBe(chosen);
  });
});

describe('error mapping', () => {
  it('finds the error of an organization field, including per-item paths', () => {
    const map = toErrorMap([
      { path: 'categoryId', code: 'unknown' },
      { path: 'tagIds.1', code: 'unknown' },
      { path: 'collectionIds.0', code: 'automated_collection' },
      { path: 'tagNames.0', code: 'too_long' },
    ]);
    expect(organizationError(map, 'category')).toBe('unknown');
    expect(organizationError(map, 'tags')).toBe('unknown');
    expect(organizationError(map, 'collections')).toBe('automated_collection');
    expect(organizationError({ 'tagNames.2': 'too_long' }, 'tags')).toBe('too_long');
  });

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

  it('shows a removed variant used by open orders on the variants section', () => {
    expect(toErrorMap([{ path: 'variants.2', code: 'VARIANT_IN_ORDERS' }])).toEqual({
      variants: 'VARIANT_IN_ORDERS',
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
