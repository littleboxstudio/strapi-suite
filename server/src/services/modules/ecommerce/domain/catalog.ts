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

export const isBlank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/** True when the HTML has no visible text (`<p></p>`, `<p><br></p>`, whitespace, `&nbsp;`). */
export function isBlankHtml(html: unknown): boolean {
  if (typeof html !== 'string') return true;
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return text.replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim() === '';
}

/** A non-default product translation with no name and no other content (nothing to store). */
export function isEmptyProductTranslation(
  t: { name?: string; shortDescription?: string; description?: string } | undefined
): boolean {
  return isBlank(t?.name) && isBlank(t?.shortDescription) && isBlankHtml(t?.description);
}

export function validateProductInput(input: ProductInput, defaultLocale: string): FieldError[] {
  const errors: FieldError[] = [];

  const main = input.translations?.[defaultLocale];
  if (isBlank(main?.name)) {
    errors.push({ path: `translations.${defaultLocale}.name`, code: 'required' });
  }
  if (isBlankHtml(main?.description)) {
    errors.push({ path: `translations.${defaultLocale}.description`, code: 'required' });
  }
  for (const [locale, t] of Object.entries(input.translations ?? {})) {
    if (locale === defaultLocale) continue;
    if (isBlank(t?.name) && !isEmptyProductTranslation(t)) {
      errors.push({ path: `translations.${locale}.name`, code: 'required' });
    }
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
