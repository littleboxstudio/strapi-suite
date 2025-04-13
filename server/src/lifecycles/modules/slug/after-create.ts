import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function AfterCreateSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.model.attributes) {
    if (
      event.model.attributes[key].hasOwnProperty("customField")
      && event.model.attributes[key].customField === config.uuid.customFields.slug)
    {
      await createSlug(event, config);
      await createAttributes(event, config);
    }
  }
}

async function createSlug(event: any, config: LtbConfigs) { 
  if (event.state === "published") { 
    await strapi.db.query(config.uuid.modules.slug).delete({
      where: {
        state: "published",
        locale: event.params.data.locale,
        contentId: event.result.documentId,
      }
    });
    const draftDocument = await strapi.db.query(config.uuid.modules.slug).findOne({
      where: {
        state: "draft",
        locale: event.params.data.locale,
        contentId: event.result.documentId,
      }
    });
    if (draftDocument) {
      event.params.data.ltb_slug = draftDocument.slug;
      event.params.data.ltb_attribute_parent = draftDocument.parentContentId;
      event.params.data.ltb_attribute_parent_model = draftDocument.parentContentModel;
    }
  }
  if (event.params.data.ltb_slug) { 
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

async function createAttributes(event: any, config: LtbConfigs) { 
  if (event.state === "published") { 
    await strapi.db.query(config.uuid.modules.attribute).delete({
      where: {
        state: "published",
        locale: event.params.data.locale,
        contentId: event.result.documentId,
      }
    });
    const draftDocument = await strapi.db.query(config.uuid.modules.attribute).findOne({
      where: {
        state: "draft",
        locale: event.params.data.locale,
        contentId: event.result.documentId,
      }
    });
    if (draftDocument) { 
      event.params.data.ltb_attribute_parent = draftDocument.parentContentId;
      event.params.data.ltb_attribute_parent_model = draftDocument.parentContentModel;
      event.params.data.ltb_attribute_template = draftDocument.templateId;
      event.params.data.ltb_attribute_priority = draftDocument.priority;
      event.params.data.ltb_attribute_frequency = draftDocument.frequency;
    }
  }
  if (
    event.params.data.ltb_attribute_parent 
    || event.params.data.ltb_attribute_template
    || event.params.data.ltb_attribute_priority
    || event.params.data.ltb_attribute_frequency
  ) { 
    await strapi.db.query(config.uuid.modules.attribute).create({
      data: {
        state: event.state,
        locale: event.params.data.locale,
        contentId: event.result.documentId,
        contentModel: event.model.uid,
        parentContentId: event.params.data.ltb_attribute_parent || null,
        parentContentModel: event.params.data.ltb_attribute_parent_model || null,
        templateId: event.params.data.ltb_attribute_template || null,
        priority: event.params.data.ltb_attribute_priority || null,
        frequency: event.params.data.ltb_attribute_frequency || null,
      }
    })
  }
}