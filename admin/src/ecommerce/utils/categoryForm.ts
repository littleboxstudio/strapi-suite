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
