import sanitizeHtml from 'sanitize-html';

export type VariantInput = {
  id?: number;
  sku: string;
  price: number;
  tax: number;
  stock: number;
  weight: number;
  width: number;
  height: number;
  depth: number;
  active: boolean;
  translations: Record<string, { option: string }>;
};

export type ProductInput = {
  active: boolean;
  translations: Record<
    string,
    { name: string; slug?: string; shortDescription?: string; description: string }
  >;
  variants: VariantInput[];
};

export type FieldError = {
  path: string;
  code: 'required' | 'min_variants' | 'duplicate_sku' | 'invalid_number' | 'out_of_range';
};

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveUniqueSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u'],
    allowedAttributes: {},
    transformTags: { b: 'strong', i: 'em' },
  });
}

const isBlank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

export function validateProductInput(input: ProductInput, defaultLocale: string): FieldError[] {
  const errors: FieldError[] = [];

  if (isBlank(input.translations?.[defaultLocale]?.name)) {
    errors.push({ path: `translations.${defaultLocale}.name`, code: 'required' });
  }

  const variants = input.variants ?? [];
  if (variants.length === 0) {
    errors.push({ path: 'variants', code: 'min_variants' });
  }

  const seenSkus = new Set<string>();
  variants.forEach((v, i) => {
    const base = `variants.${i}`;

    if (isBlank(v.sku)) {
      errors.push({ path: `${base}.sku`, code: 'required' });
    } else {
      const sku = v.sku.trim();
      if (seenSkus.has(sku)) errors.push({ path: `${base}.sku`, code: 'duplicate_sku' });
      seenSkus.add(sku);
    }

    if (isBlank(v.translations?.[defaultLocale]?.option)) {
      errors.push({ path: `${base}.translations.${defaultLocale}.option`, code: 'required' });
    }

    const num = (field: 'price' | 'tax' | 'stock' | 'weight' | 'width' | 'height' | 'depth') => {
      const value = v[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path: `${base}.${field}`, code: 'invalid_number' });
        return;
      }
      if ((field === 'stock' || field === 'price') && !Number.isInteger(value)) {
        errors.push({ path: `${base}.${field}`, code: 'invalid_number' });
        return;
      }
      const max = field === 'tax' ? 100 : Infinity;
      if (value < 0 || value > max) {
        errors.push({ path: `${base}.${field}`, code: 'out_of_range' });
      }
    };
    (['price', 'tax', 'stock', 'weight', 'width', 'height', 'depth'] as const).forEach(num);
  });

  return errors;
}
