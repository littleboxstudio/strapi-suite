import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function AfterFindManySlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug
      && event.result 
      && event.result.length > 0
    ) {
      for (const [i, item] of event.result.entries()) {
        const document = await strapi.db.query(config.uuid.modules.slug).findOne({
          where: {
            contentId: item.documentId,
            locale: item.locale,
            state: item.publishedAt ? 'published' : 'draft'
          }
        });
        if (document) {
          event.result[i][key] = document.slug;
        }
      }
    }
  }
}