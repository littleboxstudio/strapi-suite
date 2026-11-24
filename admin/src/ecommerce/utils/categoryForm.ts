export type CategoryTextForm = {
  name: string;
  slug: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

const OTHER_FIELDS = ['slug', 'description', 'seoTitle', 'seoDescription'] as const;

/**
 * Field errors (path -> code) before a category is saved: the default locale needs a name, and so
 * does any other locale with some text — the server drops a non-default translation whose name is
 * blank, which would silently lose its slug, description and SEO texts.
 */
export function validateCategoryTexts(
  translations: Record<string, CategoryTextForm>,
  defaultLocale: string
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!translations[defaultLocale]?.name?.trim()) errors[`translations.${defaultLocale}.name`] = 'required';
  for (const [locale, tr] of Object.entries(translations)) {
    if (locale === defaultLocale || tr?.name?.trim()) continue;
    if (OTHER_FIELDS.some((field) => !!tr?.[field]?.trim())) errors[`translations.${locale}.name`] = 'required';
  }
  return errors;
}

/** As the server's slug: accents dropped, lower case, runs of other characters become one "-". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The slug after the name changes from `prevName` to `nextName`: it follows the name while it is
 * empty or still the slug of the previous name; a slug edited by hand is kept. A slug taken by
 * another category gets "-2", "-3", … from the server on save.
 */
export function followNameSlug(prevName: string, prevSlug: string, nextName: string): string {
  const current = prevSlug.trim();
  return current === '' || current === slugify(prevName) ? slugify(nextName) : prevSlug;
}
