import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from "../config";

async function getSlugByDocumentId(params: { contentId: string, locale: string, strapi: Core.Strapi }) { 
  const config: LtbConfigs = params.strapi.config.get(`plugin::${PLUGIN_ID}`);
  const document = await params.strapi.db.query(config.uuid.modules.slug).findOne({
    where: {
      locale: params.locale,
      contentId: params.contentId,
      state: "published"
    }
  });
  if (document.parentContentId) { 
    const parentSlug = await getSlugByDocumentId({
      contentId: document.parentContentId,
      locale: params.locale,
      strapi: params.strapi
    });
    return `${parentSlug}/${document.slug}`;
  }
  return document.slug;
}

export { getSlugByDocumentId };