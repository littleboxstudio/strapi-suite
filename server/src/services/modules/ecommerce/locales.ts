import type { Core } from '@strapi/strapi';

/**
 * The i18n locale for `code`: the configured locale it names (case-insensitive, returned with the
 * stored code's case), or the default locale when it names none (unknown, empty or not a string).
 * Orders and customers never keep a locale the backend does not have.
 */
export const resolveLocale = async (strapi: Core.Strapi, code: unknown): Promise<string> =>
  (await findLocale(strapi, code)) ?? strapi.plugin('i18n').service('locales').getDefaultLocale();

/** The configured locale `code` names (case-insensitive, with the stored code's case), or null. */
export const findLocale = async (strapi: Core.Strapi, code: unknown): Promise<string | null> => {
  const wanted = typeof code === 'string' ? code.trim().toLowerCase() : '';
  if (!wanted) return null;
  const list: unknown = await strapi.plugin('i18n').service('locales').find();
  const match = (Array.isArray(list) ? list : []).find(
    (l: any) => typeof l?.code === 'string' && l.code.toLowerCase() === wanted
  );
  return match ? (match as { code: string }).code : null;
};
