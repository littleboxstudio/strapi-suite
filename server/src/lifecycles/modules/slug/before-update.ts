import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function BeforeUpdateSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug)
    {
      event.state = event.params.data.publishedAt ? "published" : "draft";
      event.params.data[key] = null;
      if (event.params.data.ltb_slug) { 
        const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
        const document = await strapi.db.query(event.model.uid).findOne({ where: { id: event.params.where.id } });
        const documentSlug = await strapi.db.query(config.uuid.modules.slug).findOne({
          where: {
            state: event.state,
            contentId: document.documentId,
            locale: event.params.data.locale
          }
        });
        const documentWithSameSlug = await strapi.db.query(config.uuid.modules.slug).findOne({
          where: {
            contentId: {
              $not: { 
                $eq: document.documentId
              }
            },
            slug: event.params.data.ltb_slug,
            parentContentId: documentSlug
              ? (documentSlug.parentContentId || null)
              : (event.params.data.ltb_attribute_parent || null),
            locale: event.params.data.locale
          }
        });
        event.params.data.ltb_slug = documentWithSameSlug
          ? `${event.params.data.ltb_slug}-${Date.now()}`
          : event.params.data.ltb_slug;
      }      
    }
  }
}