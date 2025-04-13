import { PLUGIN_ID, LtbConfigs } from '../../../config';

export default async function AfterDeleteSlug(event: any) { 
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  for (const key in event.contentType.attributes) {
    if (
      event.contentType.attributes[key].hasOwnProperty("customField")
      && event.contentType.attributes[key].customField === config.uuid.customFields.slug
    ) {
      await deleteSlug(event, config);
      await deleteAttributes(event, config);  
    }
  }
}

async function deleteSlug(event: any, config: LtbConfigs) { 
  const deleteManyWhere = {
    where: {
      contentId: event.params.documentId,
      locale: event.params.locale,
    }
  };
  const updateManyWhere = {
    where: {
      parentContentId: event.params.documentId,
      locale: event.params.locale,
    },
    data: {
      parentContentId: null,
      parentContentModel: null
    }
  };
  if (event.params.locale === "*") { 
    delete deleteManyWhere.where.locale;
    delete updateManyWhere.where.locale;
  }
  await strapi.db.query(config.uuid.modules.slug).deleteMany(deleteManyWhere);
  await strapi.db.query(config.uuid.modules.slug).updateMany(updateManyWhere);
}

async function deleteAttributes(event: any, config: LtbConfigs) { 
  const deleteManyWhere = {
    where: {
      contentId: event.params.documentId,
      locale: event.params.locale,
    }
  };
  const updateManyWhere = {
    where: {
      parentContentId: event.params.documentId,
      locale: event.params.locale,
    },
    data: {
      parentContentId: null,
      parentContentModel: null
    }
  };
  if (event.params.locale === "*") { 
    delete deleteManyWhere.where.locale;
    delete updateManyWhere.where.locale;
  }
  await strapi.db.query(config.uuid.modules.attribute).deleteMany(deleteManyWhere);
  await strapi.db.query(config.uuid.modules.attribute).updateMany(updateManyWhere);
}