import type { Core } from '@strapi/strapi';
import { getSlugByDocumentId } from "./getSlugByDocumentId";

export async function findDocumentIdsAndFetchSlugs(params: {
  document: any, 
  defaultLocale: string;
  showDefaultLanguage: boolean;
  strapi: Core.Strapi;
}) {
  if (!params.document || typeof params.document !== 'object') return;
  const promises = [];
  async function traverse(current) {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        await traverse(current[i]);
      }
      return;
    }
    if ('documentId' in current) {
      promises.push(
        (async () => {
          const slug = await getSlugByDocumentId({
            contentId: current.documentId,
            locale: current.locale,
            defaultLocale: params.defaultLocale,
            showDefaultLanguage: params.showDefaultLanguage,
            strapi
          });
          current.slug = slug;
        })()
      );
    }
    for (const key in current) {
      if (Object.prototype.hasOwnProperty.call(current, key) && current[key] !== null) {
        await traverse(current[key]);
      }
    }
  }
  await traverse(params.document);
  await Promise.all(promises);
  return params.document;
}