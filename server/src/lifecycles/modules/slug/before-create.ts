import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function BeforeCreateSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug)
    {
      event.state = event.params.data.publishedAt ? "published" : "draft";
      event.params.data[key] = null;
      if (event.params.data.ltb_slug) { 
        const result = await strapi.db.query(config.uuid.modules.slug).findMany({
          where: {
            slug: event.params.data.ltb_slug,
            parentContentId: event.params.data.ltb_attribute_parent || null,
            locale: event.params.data.locale
          }
        });
        event.params.data.ltb_slug = result.length > 0
          ? `${event.params.data.ltb_slug}-${Date.now()}`
          : event.params.data.ltb_slug;
      }
    }
  }
}