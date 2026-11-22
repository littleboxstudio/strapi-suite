import { describe, it, expect } from 'vitest';
import {
  slugify,
  resolveUniqueSlug,
  sanitizeDescription,
  validateProductInput,
  type ProductInput,
  type VariantInput,
} from '../../../../server/src/services/modules/ecommerce/domain/catalog';

const variant = (over: Partial<VariantInput> = {}): VariantInput => ({
  sku: 'A',
  price: 1000,
  tax: 23,
  stock: 5,
  weight: 1,
  width: 1,
  height: 1,
  depth: 1,
  active: true,
  translations: { en: { option: 'Red' } },
  ...over,
});

const product = (over: Partial<ProductInput> = {}): ProductInput => ({
  active: true,
  translations: { en: { name: 'Mug', description: '<p>A mug</p>' } },
  variants: [variant()],
  ...over,
});

describe('slugify', () => {
  it('normalizes accents and punctuation', () => {
    expect(slugify('Camisa de Linho Ação!')).toBe('camisa-de-linho-acao');
  });
});

describe('resolveUniqueSlug', () => {
  it('adds numeric suffix when taken', () => {
    expect(resolveUniqueSlug('camisa', ['camisa', 'camisa-2'])).toBe('camisa-3');
  });
  it('returns base when free', () => {
    expect(resolveUniqueSlug('caneca', [])).toBe('caneca');
  });
});

describe('sanitizeDescription', () => {
  it('keeps allow-list, strips attributes and scripts, maps b/i', () => {
    expect(
      sanitizeDescription('<p><b>A</b> <a href="x">B</a><script>x</script><u style="c">C</u></p>')
    ).toBe('<p><strong>A</strong> B<u>C</u></p>');
  });
  it('maps i to em', () => {
    expect(sanitizeDescription('<i>x</i>')).toBe('<em>x</em>');
  });
});

describe('validateProductInput', () => {
  it('accepts valid input', () => {
    expect(validateProductInput(product(), 'en')).toEqual([]);
  });
  it('requires at least one variant', () => {
    expect(validateProductInput(product({ variants: [] }), 'en')).toContainEqual({
      path: 'variants',
      code: 'min_variants',
    });
  });
  it('requires default-locale name only', () => {
    const errs = validateProductInput(
      product({ translations: { pt: { name: '', description: '' } } }),
      'en'
    );
    expect(errs).toContainEqual({ path: 'translations.en.name', code: 'required' });
    const errs2 = validateProductInput(
      product({
        translations: {
          en: { name: 'Mug', description: '<p>A mug</p>' },
          pt: { name: '', shortDescription: ' ', description: '<p><br></p>' },
        },
      }),
      'en'
    );
    expect(errs2).toEqual([]);
  });
  it('flags duplicate sku', () => {
    expect(
      validateProductInput(product({ variants: [variant(), variant()] }), 'en')
    ).toContainEqual({ path: 'variants.1.sku', code: 'duplicate_sku' });
  });
  it('validates numeric ranges', () => {
    expect(validateProductInput(product({ variants: [variant({ price: -1 })] }), 'en')).toContainEqual({
      path: 'variants.0.price',
      code: 'out_of_range',
    });
    expect(validateProductInput(product({ variants: [variant({ tax: 101 })] }), 'en')).toContainEqual({
      path: 'variants.0.tax',
      code: 'out_of_range',
    });
    expect(validateProductInput(product({ variants: [variant({ stock: 1.5 })] }), 'en')).toContainEqual({
      path: 'variants.0.stock',
      code: 'invalid_number',
    });
    expect(validateProductInput(product({ variants: [variant({ weight: NaN })] }), 'en')).toContainEqual({
      path: 'variants.0.weight',
      code: 'invalid_number',
    });
  });
  it('accepts any integer stock, including negative', () => {
    expect(validateProductInput(product({ variants: [variant({ stock: -2 })] }), 'en')).toEqual([]);
  });
  it('validates stockAdjustment as an integer when present', () => {
    expect(
      validateProductInput(product({ variants: [variant({ stockAdjustment: -3 })] }), 'en')
    ).toEqual([]);
    expect(
      validateProductInput(product({ variants: [variant({ stockAdjustment: 1.5 })] }), 'en')
    ).toContainEqual({ path: 'variants.0.stockAdjustment', code: 'invalid_number' });
    expect(
      validateProductInput(product({ variants: [variant({ stockAdjustment: '2' as any })] }), 'en')
    ).toContainEqual({ path: 'variants.0.stockAdjustment', code: 'invalid_number' });
  });
  it('requires variant option in default locale', () => {
    expect(
      validateProductInput(product({ variants: [variant({ translations: {} })] }), 'en')
    ).toContainEqual({ path: 'variants.0.translations.en.option', code: 'required' });
  });
  it('requires visible default-locale description', () => {
    for (const description of ['', '<p></p>', '<p><br></p>', '<p> &nbsp; </p>']) {
      expect(
        validateProductInput(product({ translations: { en: { name: 'Mug', description } } }), 'en')
      ).toContainEqual({ path: 'translations.en.description', code: 'required' });
    }
    expect(
      validateProductInput(product({ translations: { en: { name: 'Mug', description: '<p>x</p>' } } }), 'en')
    ).toEqual([]);
  });
  it('requires a name in a non-default locale that has other content', () => {
    const withShort = validateProductInput(
      product({
        translations: {
          en: { name: 'Mug', description: '<p>A mug</p>' },
          pt: { name: ' ', shortDescription: 'Caneca bonita', description: '' },
        },
      }),
      'en'
    );
    expect(withShort).toEqual([{ path: 'translations.pt.name', code: 'required' }]);
    const withDescription = validateProductInput(
      product({
        translations: {
          en: { name: 'Mug', description: '<p>A mug</p>' },
          pt: { name: '', description: '<p>Caneca</p>' },
        },
      }),
      'en'
    );
    expect(withDescription).toEqual([{ path: 'translations.pt.name', code: 'required' }]);
  });
});

describe('validateProductInput — organization fields', () => {
  const codesAt = (input: ProductInput, path: string) =>
    validateProductInput(input, 'en')
      .filter((e) => e.path === path)
      .map((e) => e.code);

  it('refuses a compare-at price equal to the price', () => {
    expect(codesAt(product({ variants: [variant({ compareAtPrice: 1000 })] }), 'variants.0.compareAtPrice')).toEqual([
      'compare_at_not_above_price',
    ]);
  });

  it('refuses a compare-at price below the price', () => {
    expect(codesAt(product({ variants: [variant({ compareAtPrice: 999 })] }), 'variants.0.compareAtPrice')).toEqual([
      'compare_at_not_above_price',
    ]);
  });

  it('accepts a compare-at price above the price, null or absent', () => {
    expect(validateProductInput(product({ variants: [variant({ compareAtPrice: 1500 })] }), 'en')).toEqual([]);
    expect(validateProductInput(product({ variants: [variant({ compareAtPrice: null })] }), 'en')).toEqual([]);
    expect(validateProductInput(product(), 'en')).toEqual([]);
  });

  it('refuses a non-integer or negative compare-at price', () => {
    expect(codesAt(product({ variants: [variant({ compareAtPrice: 1500.5 })] }), 'variants.0.compareAtPrice')).toEqual([
      'invalid_number',
    ]);
    expect(
      codesAt(product({ variants: [variant({ compareAtPrice: 'x' as any })] }), 'variants.0.compareAtPrice')
    ).toEqual(['invalid_number']);
  });

  it('refuses a vendor longer than 255 characters (after trimming)', () => {
    expect(codesAt(product({ vendor: 'a'.repeat(256) }), 'vendor')).toEqual(['too_long']);
    expect(validateProductInput(product({ vendor: ` ${'a'.repeat(255)} ` }), 'en')).toEqual([]);
    expect(validateProductInput(product({ vendor: null }), 'en')).toEqual([]);
  });

  it('refuses malformed organization ids as unknown', () => {
    expect(codesAt(product({ categoryId: 0 }), 'categoryId')).toEqual(['unknown']);
    expect(codesAt(product({ productTypeId: 'x' as any }), 'productTypeId')).toEqual(['unknown']);
    expect(codesAt(product({ tagIds: [1, -2] }), 'tagIds.1')).toEqual(['unknown']);
    expect(codesAt(product({ collectionIds: [1.5] }), 'collectionIds.0')).toEqual(['unknown']);
    expect(codesAt(product({ tagIds: 'x' as any }), 'tagIds')).toEqual(['unknown']);
    expect(
      validateProductInput(product({ categoryId: null, productTypeId: null, tagIds: [], collectionIds: [] }), 'en')
    ).toEqual([]);
  });

  it('refuses type and tag names longer than 255 characters', () => {
    expect(codesAt(product({ productTypeName: 'a'.repeat(256) }), 'productTypeName')).toEqual(['too_long']);
    expect(codesAt(product({ tagNames: ['ok', 'a'.repeat(256)] }), 'tagNames.1')).toEqual(['too_long']);
  });
});
