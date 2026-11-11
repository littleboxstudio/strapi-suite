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
  translations: { en: { name: 'Mug', description: '' } },
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
        translations: { en: { name: 'Mug', description: '' }, pt: { name: '', description: '' } },
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
  it('requires variant option in default locale', () => {
    expect(
      validateProductInput(product({ variants: [variant({ translations: {} })] }), 'en')
    ).toContainEqual({ path: 'variants.0.translations.en.option', code: 'required' });
  });
});
