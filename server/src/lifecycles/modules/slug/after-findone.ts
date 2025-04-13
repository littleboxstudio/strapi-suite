import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function AfterFindOneSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug
      && event.result
    ) {
      const documentSlug = await strapi.db.query(config.uuid.modules.slug).findOne({
        where: {
          contentId: event.result.documentId,
          locale: event.result.locale,
          state: event.result.publishedAt ? 'published' : 'draft'
        }
      });
      if (documentSlug) {
        event.result[key] = documentSlug.slug;
      }
    }
  }
}