import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../config';

async function getSlugByDocumentId(params: {
  contentId: string;
  locale: string;
  defaultLocale: string;
  showDefaultLanguage: boolean;
  strapi: Core.Strapi;
}) {
  const config: LtbConfigs = params.strapi.config.get(`plugin::${PLUGIN_ID}`);
  const document = await params.strapi.db.query(config.uuid.modules.slug).findOne({
    where: {
      locale: params.locale,
      contentId: params.contentId,
      state: 'published',
    },
  });
  if (!document) return null;
  if (document.parentContentId) {
    const parentSlug = await getSlugByDocumentId({
      contentId: document.parentContentId,
      locale: params.locale,
      defaultLocale: params.defaultLocale,
      showDefaultLanguage: params.showDefaultLanguage,
      strapi: params.strapi,
    });
    return `${parentSlug}/${document.slug}`;
  }
  return params.showDefaultLanguage ||
    (!params.showDefaultLanguage && params.defaultLocale !== params.locale)
    ? `${params.locale.toLowerCase()}/${document.slug}`
    : document.slug;
}

export { getSlugByDocumentId };
