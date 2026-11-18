import type { Core } from '@strapi/strapi';

/**
 * The i18n locale for `code`: the configured locale it names (case-insensitive, returned with the
 * stored code's case), or the default locale when it names none (unknown, empty or not a string).
 * Orders and customers never keep a locale the backend does not have.
 */
export const resolveLocale = async (strapi: Core.Strapi, code: unknown): Promise<string> => {
  const locales = strapi.plugin('i18n').service('locales');
  const wanted = typeof code === 'string' ? code.trim().toLowerCase() : '';
  if (wanted) {
    const list: unknown = await locales.find();
    const match = (Array.isArray(list) ? list : []).find(
      (l: any) => typeof l?.code === 'string' && l.code.toLowerCase() === wanted
    );
    if (match) return (match as { code: string }).code;
  }
  return locales.getDefaultLocale();
};
