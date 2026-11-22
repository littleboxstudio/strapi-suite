import type {
  FieldError,
  ImageRecord,
  ProductDetail,
  ProductInput,
  TranslateInput,
  VariantInput,
} from '../types';

/**
 * A variant as the form keeps it: `key` identifies the row, `images` feed the thumbnail and
 * `deletable` is false for a saved variant that is in some order (new variants: absent).
 */
export type FormVariant = VariantInput & { key: string; images: ImageRecord[]; deletable?: boolean };

export type ProductTranslation = {
  name: string;
  slug?: string;
  shortDescription: string;
  description: string;
};

/** A chosen tag: existing ones carry their id, new ones (created on save) only a name. */
export type FormTag = { id?: number; name: string };

export type FormCollection = { id: number; title: string };

/** The "Product organization" section. */
export type ProductOrganization = {
  vendor: string;
  /** `path` is the full label ("Clothing > Shirts > Linen"). */
  category: { id: number; path: string } | null;
  /** Without an id: a new type, created by name on save. */
  productType: { id?: number; name: string } | null;
  tags: FormTag[];
  /** MANUAL collections: the full set is sent. */
  collections: FormCollection[];
  /** AUTOMATED collections the product is in: read-only, computed by the server. */
  automatedCollections: FormCollection[];
};

export type ProductForm = {
  active: boolean;
  translations: Record<string, ProductTranslation>;
  variants: FormVariant[];
  organization: ProductOrganization;
};

export const MAX_VENDOR_LENGTH = 255;

/** Field errors indexed by path (e.g. `variants.1.sku`). */
export type ErrorMap = Record<string, FieldError['code']>;

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === '';

const blankTranslation = (): ProductTranslation => ({
  name: '',
  shortDescription: '',
  description: '',
});

export function emptyOrganization(): ProductOrganization {
  return {
    vendor: '',
    category: null,
    productType: null,
    tags: [],
    collections: [],
    automatedCollections: [],
  };
}

export function emptyProductForm(localeCodes: string[]): ProductForm {
  return {
    active: true,
    translations: Object.fromEntries(localeCodes.map((code) => [code, blankTranslation()])),
    variants: [],
    organization: emptyOrganization(),
  };
}

function organizationFromDetail(detail: ProductDetail): ProductOrganization {
  const collections = detail.collections ?? [];
  const pick = (type: 'MANUAL' | 'AUTOMATED') =>
    collections.filter((c) => c.type === type).map(({ id, title }) => ({ id, title }));
  return {
    vendor: detail.vendor ?? '',
    category:
      detail.categoryId != null
        ? {
            id: detail.categoryId,
            path: (detail.categoryPath ?? []).map((c) => c.name).join(' > '),
          }
        : null,
    productType:
      detail.productTypeId != null
        ? { id: detail.productTypeId, name: detail.productTypeName ?? '' }
        : null,
    tags: (detail.tags ?? []).map(({ id, name }) => ({ id, name })),
    collections: pick('MANUAL'),
    automatedCollections: pick('AUTOMATED'),
  };
}

/** Case- and spacing-insensitive key of a tag name. */
const tagKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Adds a tag to the chosen ones: a picked suggestion (with id) or a typed name, which becomes the
 * existing tag when it matches a suggestion. Blanks and names already chosen are ignored (the same
 * array is returned).
 */
export function addTag(
  chosen: FormTag[],
  value: string | { id: number; name: string },
  suggestions: { id: number; name: string }[]
): FormTag[] {
  const name = (typeof value === 'string' ? value : value.name).trim().replace(/\s+/g, ' ');
  if (name === '') return chosen;
  const key = tagKey(name);
  if (typeof value !== 'string') {
    if (chosen.some((tag) => tag.id === value.id || tagKey(tag.name) === key)) return chosen;
    return [...chosen, { id: value.id, name: value.name }];
  }
  if (chosen.some((tag) => tagKey(tag.name) === key)) return chosen;
  const existing = suggestions.find((s) => tagKey(s.name) === key);
  return [...chosen, existing ? { id: existing.id, name: existing.name } : { name }];
}

export function productFormFromDetail(detail: ProductDetail, localeCodes: string[]): ProductForm {
  const translations: Record<string, ProductTranslation> = {};
  localeCodes.forEach((code) => {
    const t = detail.translations[code];
    translations[code] = t
      ? {
          name: t.name ?? '',
          ...(t.slug ? { slug: t.slug } : {}),
          shortDescription: t.shortDescription ?? '',
          description: t.description ?? '',
        }
      : blankTranslation();
  });

  const variants = detail.variants.map((v) => ({
    ...v,
    key: `id-${v.id}`,
    images: v.images ?? [],
    translations: Object.fromEntries(
      localeCodes.map((code) => [code, { option: v.translations[code]?.option ?? '' }])
    ),
  }));

  return { active: detail.active, translations, variants, organization: organizationFromDetail(detail) };
}

/**
 * Every organization field is sent explicitly (empty = cleared). Tags go as ids and names together:
 * names alone would replace the stored tags.
 */
function organizationInput(org: ProductOrganization): Partial<ProductInput> {
  const vendor = org.vendor.trim();
  const type = org.productType;
  return {
    vendor: vendor === '' ? null : vendor,
    categoryId: org.category?.id ?? null,
    ...(type && type.id === undefined
      ? { productTypeName: type.name.trim() }
      : { productTypeId: type?.id ?? null }),
    tagIds: org.tags.filter((tag) => tag.id !== undefined).map((tag) => tag.id as number),
    tagNames: org.tags.filter((tag) => tag.id === undefined).map((tag) => tag.name),
    collectionIds: org.collections.map((c) => c.id),
  };
}

export function buildProductInput(form: ProductForm): ProductInput {
  return {
    ...organizationInput(form.organization),
    active: form.active,
    translations: Object.fromEntries(
      Object.entries(form.translations).map(([code, t]) => [
        code,
        { name: t.name, shortDescription: t.shortDescription, description: t.description },
      ])
    ),
    variants: form.variants.map(
      ({ key: _key, images: _images, deletable: _deletable, ...variant }) => variant
    ),
  };
}

/** True when the HTML has no visible text (`<p></p>`, `<p><br></p>`, whitespace). */
export function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim() === ''
  );
}

/** Client-side checks run before sending; the server validates everything again. */
export function validateProductForm(form: ProductForm, defaultLocale: string): FieldError[] {
  const errors: FieldError[] = [];
  const t = form.translations[defaultLocale];
  if (isBlank(t?.name)) {
    errors.push({ path: `translations.${defaultLocale}.name`, code: 'required' });
  }
  if (!t || isBlankHtml(t.description)) {
    errors.push({ path: `translations.${defaultLocale}.description`, code: 'required' });
  }
  if (form.variants.length === 0) {
    errors.push({ path: 'variants', code: 'min_variants' });
  }
  if (form.organization.vendor.trim().length > MAX_VENDOR_LENGTH) {
    errors.push({ path: 'vendor', code: 'too_long' });
  }
  return errors;
}

export function toErrorMap(errors: FieldError[]): ErrorMap {
  const map: ErrorMap = {};
  errors.forEach(({ path, code }) => {
    // The variant was removed from the form, so the message belongs to the variants section.
    const key = code === 'VARIANT_IN_ORDERS' ? 'variants' : path;
    if (!(key in map)) map[key] = code;
  });
  return map;
}

/** Errors under `prefix`, with the prefix removed (`variants.1.sku` → `sku`). */
export function scopedErrors(map: ErrorMap, prefix: string): ErrorMap {
  const start = `${prefix}.`;
  const scoped: ErrorMap = {};
  Object.entries(map).forEach(([path, code]) => {
    if (path.startsWith(start)) scoped[path.slice(start.length)] = code;
  });
  return scoped;
}

/** Server paths of each organization field (per-item paths like `tagIds.1` included). */
export type OrganizationField = 'vendor' | 'category' | 'productType' | 'tags' | 'collections';

export const ORGANIZATION_ERROR_PATHS: Record<OrganizationField, string[]> = {
  vendor: ['vendor'],
  category: ['categoryId'],
  productType: ['productTypeId', 'productTypeName'],
  tags: ['tagIds', 'tagNames'],
  collections: ['collectionIds'],
};

/** The first error code of an organization field, or undefined. */
export function organizationError(
  map: ErrorMap,
  field: OrganizationField
): FieldError['code'] | undefined {
  const prefix = ORGANIZATION_ERROR_PATHS[field].find((p) => hasErrorsUnder(map, p));
  if (!prefix) return undefined;
  const path = Object.keys(map).find((p) => p === prefix || p.startsWith(`${prefix}.`));
  return path ? map[path] : undefined;
}

export function hasErrorsUnder(map: ErrorMap, prefix: string): boolean {
  return Object.keys(map).some((path) => path === prefix || path.startsWith(`${prefix}.`));
}

/** The `FieldError[]` of a 400 thrown by Strapi's fetch client, or null for any other error. */
export function extractFieldErrors(err: unknown): FieldError[] | null {
  const errors = (err as any)?.response?.data?.error?.details?.errors;
  return Array.isArray(errors) ? errors : null;
}

const PRODUCT_FIELDS = ['name', 'shortDescription', 'description'] as const;
const OPTION_KEY = /^variants\.(\d+)\.option$/;

const fieldIsBlank = (field: (typeof PRODUCT_FIELDS)[number], value: string | undefined) =>
  field === 'description' ? isBlankHtml(value ?? '') : isBlank(value);

/**
 * Strings of the default locale to translate, and the locales that still have at least one of
 * those fields blank. Null when there is nothing to do.
 */
export function buildTranslationRequest(
  form: ProductForm,
  defaultLocale: string,
  localeCodes: string[]
): TranslateInput | null {
  const source = form.translations[defaultLocale];
  const strings: Record<string, string> = {};

  PRODUCT_FIELDS.forEach((field) => {
    if (source && !fieldIsBlank(field, source[field])) strings[field] = source[field];
  });
  form.variants.forEach((v, i) => {
    const option = v.translations[defaultLocale]?.option;
    if (!isBlank(option)) strings[`variants.${i}.option`] = option;
  });

  const keys = Object.keys(strings);
  if (keys.length === 0) return null;

  const targetLocales = localeCodes.filter(
    (code) =>
      code !== defaultLocale &&
      keys.some((key) => {
        const match = key.match(OPTION_KEY);
        if (match) return isBlank(form.variants[Number(match[1])].translations[code]?.option);
        const field = key as (typeof PRODUCT_FIELDS)[number];
        return fieldIsBlank(field, form.translations[code]?.[field]);
      })
  );

  return targetLocales.length ? { sourceLocale: defaultLocale, targetLocales, strings } : null;
}

/** Copies AI results into the blank fields only; filled fields are never overwritten. */
export function applyTranslations(
  form: ProductForm,
  translations: Record<string, Record<string, string>>
): ProductForm {
  const next: ProductForm = {
    ...form,
    translations: { ...form.translations },
    variants: form.variants.map((v) => ({ ...v, translations: { ...v.translations } })),
  };

  Object.entries(translations).forEach(([code, strings]) => {
    const t = { ...(next.translations[code] ?? blankTranslation()) };
    Object.entries(strings).forEach(([key, value]) => {
      if (isBlank(value)) return;
      const match = key.match(OPTION_KEY);
      if (match) {
        const variant = next.variants[Number(match[1])];
        if (variant && isBlank(variant.translations[code]?.option)) {
          variant.translations[code] = { option: value };
        }
        return;
      }
      const field = key as (typeof PRODUCT_FIELDS)[number];
      if (PRODUCT_FIELDS.includes(field) && fieldIsBlank(field, t[field])) t[field] = value;
    });
    next.translations[code] = t;
  });

  return next;
}
