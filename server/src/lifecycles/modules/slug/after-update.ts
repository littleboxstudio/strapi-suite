import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function AfterUpdateSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug)
    {
      const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
      await updateSlug(event, config);
      await updateAttributes(event, config);
    }
  }
}

async function updateSlug(event: any, config: LtbConfigs) { 
  if (
    event.params.data.hasOwnProperty("ltb_slug")
    || event.params.data.hasOwnProperty("ltb_attribute_parent")
  ) { 
    const documentSlug = await strapi.db.query(config.uuid.modules.slug).findOne({
      where: {
        state: event.state,
        contentId: event.result.documentId,
        locale: event.params.data.locale
      }
    });
    if (documentSlug) {
      await strapi.db.query(config.uuid.modules.slug).update({
        where: {
          id: documentSlug.id
        },
        data: {
          slug: event.params.data.hasOwnProperty("ltb_slug")
            ? event.params.data.ltb_slug
            : documentSlug.slug,
          parentContentId: event.params.data.hasOwnProperty("ltb_attribute_parent")
            ? event.params.data.ltb_attribute_parent
            : documentSlug.parentContentId,
          parentContentModel: event.params.data.hasOwnProperty("ltb_attribute_parent_model")
            ? event.params.data.ltb_attribute_parent_model
            : documentSlug.parentContentModel,
        }
      })
    }
    if (!documentSlug && event.params.data.hasOwnProperty("ltb_slug")) { 
      await strapi.db.query(config.uuid.modules.slug).create({
        data: {
          state: event.state,
          slug: event.params.data.ltb_slug,
          locale: event.params.data.locale,
          contentId: event.result.documentId,
          contentModel: event.model.uid,
          parentContentId: event.params.data.ltb_attribute_parent || null,
          parentContentModel: event.params.data.ltb_attribute_parent_model || null,
        }
      });
    }
  }
}

async function updateAttributes(event: any, config: LtbConfigs) {
  if (
    event.params.data.hasOwnProperty("ltb_attribute_parent")
    || event.params.data.hasOwnProperty("ltb_attribute_template")
    || event.params.data.hasOwnProperty("ltb_attribute_priority")
    || event.params.data.hasOwnProperty("ltb_attribute_frequency")
  ) { 
    const documentAttributes = await strapi.db.query(config.uuid.modules.attribute).findOne({
      where: {
        state: event.state,
        contentId: event.result.documentId,
        locale: event.params.data.locale
      }
    });
    if (documentAttributes) { 
      await strapi.db.query(config.uuid.modules.attribute).update({
        where: {
          id: documentAttributes.id
        },
        data: {
          parentContentId: event.params.data.hasOwnProperty("ltb_attribute_parent")
            ? event.params.data.ltb_attribute_parent
            : documentAttributes.parentContentId,
          parentContentModel: event.params.data.hasOwnProperty("ltb_attribute_parent_model")
            ? event.params.data.ltb_attribute_parent_model
            : documentAttributes.parentContentModel,
          templateId: event.params.data.hasOwnProperty("ltb_attribute_template")
            ? event.params.data.ltb_attribute_template
            : documentAttributes.templateId,
          priority: event.params.data.hasOwnProperty("ltb_attribute_priority")
            ? event.params.data.ltb_attribute_priority
            : documentAttributes.priority,
          frequency: event.params.data.hasOwnProperty("ltb_attribute_frequency")
            ? event.params.data.ltb_attribute_frequency
            : documentAttributes.frequency
        }
      });
    }
    if (!documentAttributes) { 
      await strapi.db.query(config.uuid.modules.attribute).create({
        data: {
          state: "draft",
          locale: event.params.data.locale,
          contentId: event.result.documentId,
          contentModel: event.model.uid,
          parentContentId: event.params.data.ltb_attribute_parent || null,
          parentContentModel: event.params.data.ltb_attribute_parent_model || null,
          templateId: event.params.data.ltb_attribute_template || null,
          priority: event.params.data.ltb_attribute_priority || null,
          frequency: event.params.data.ltb_attribute_frequency || null
        }
      });
    }
  }
}