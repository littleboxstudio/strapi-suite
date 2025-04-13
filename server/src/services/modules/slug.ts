import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';
import { getSlugByDocumentId } from '../../utils/getSlugByDocumentId';

function findItem(items, contentId, contentModel) {
  return items.find(item => 
    item.contentId === contentId && item.contentModel === contentModel
  );
}

function buildFullSlug(items, item) {
  if (!item.parentContentId || !item.parentContentModel) return item.slug;
  const parent = findItem(items, item.parentContentId, item.parentContentModel);
  if (!parent) return item.slug; 
  const parentFullSlug = parent.fullSlug || buildFullSlug(items, parent);
  return `${parentFullSlug}/${item.slug}`;
}

const SlugModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return [];
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        locale: ctx.query.locale,
        state: "published"
      },
      orderBy: {
        id: 'desc'
      }
    });
    const publishedResults = [];
    for (const document of documents) {
      const content = await strapi.documents(document.contentModel).findOne({
        status: 'published',
        documentId: document.contentId,
        locale: ctx.query.locale as string
      });
      if (content) {
        document.contentTitle = content.title || `${content.documentId} | ${document.contentModel}`;
        publishedResults.push(document);
      }
    }
    return publishedResults || [];
  },

  async adminBulkDelete() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return;
    const body = ctx.request.body;
    if (!body.contentIds) return;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.slug).deleteMany({
      where: {
        contentId: body.contentIds,
        locale: ctx.query.locale,
      }
    });
    ctx.status = 204;
    return;
  },

  async getPage() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) {
      ctx.status = 400;
      return;
    };
    const locale = ctx.query.locale as string;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const slug = (<string>ctx.query.slug).replace(/^\/|\/$/g, '');
    const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        locale,
        state: "published",
        slug: slug.split("/")
      }
    });
    pages.forEach(item => {
      item.fullSlug = buildFullSlug(pages, item);
    });
    const page = pages.find(page => page.fullSlug === slug);
    if (!page) {
      ctx.status = 404;
      return;
    }
    const properties: any = ctx.query.properties;
    if (properties && properties.includes('attributes')) {
      const attributes = await strapi.db.query(config.uuid.modules.attribute).findOne({
        where: {
          locale,
          contentId: page.contentId,
          contentModel: page.contentModel,
          state: "published"
        }
      });
      const template = attributes && attributes.templateId
        ? await strapi.db.query(config.uuid.modules.template).findOne({
          where: {
            documentId: attributes.templateId
          }
        })
        : null;
      page.attributes = {
        template: template?.uid || 'default',
        priority: attributes?.priority || '0.5',
        frequency: attributes?.frequency || 'weekly',
        ...(attributes?.parentContentId
          ? { parent: { id: attributes.parentContentId, model: attributes.parentContentModel }}
          : {}
        )
      }
    }
    const document = await strapi.documents(page.contentModel).findOne({
      locale,
      populate: '*',
      status: 'published',
      documentId: page.contentId,
    });
    for(const localization of document.localizations) { 
      localization.slug = await getSlugByDocumentId({
        contentId: localization.documentId,
        locale: localization.locale,
        strapi
      });
    }
    delete document.createdBy;
    delete document.updatedBy;
    document.slug = page.fullSlug;
    return {
      document,
      ...(page.attributes ? { attributes: page.attributes } : {})
    }
  },

  async getPages() { 
    const ctx = strapi.requestContext.get();
    const properties: any = ctx.query.properties;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        state: "published"
      }
    });
    pages.forEach(item => {
      item.fullSlug = buildFullSlug(pages, item);
    });
    if (properties && properties.includes('attributes')) { 
      for (const page of pages) {
        const attributes = await strapi.db.query(config.uuid.modules.attribute).findOne({
          where: {
            locale: page.locale,
            contentId: page.contentId,
            contentModel: page.contentModel,
            state: "published"
          }
        });
        const template = attributes && attributes.templateId
          ? await strapi.db.query(config.uuid.modules.template).findOne({
              where: {
                documentId: attributes.templateId
              }
            })
          : null;
        page.attributes = {
          template: template?.uid || 'default',
          priority: attributes?.priority || '0.5',
          frequency: attributes?.frequency || 'weekly',
          ...(attributes?.parentContentId
            ? { parent: { id: attributes.parentContentId, model: attributes.parentContentModel }}
            : {}
          )
        }
      }
    }
    const mappedPages = pages.map(page => ({
      id: page.contentId,
      model: page.contentModel,
      slug: page.fullSlug,
      ...(page.attributes ? { attributes: page.attributes } : {})
    }));
    return mappedPages;
  }
});

export default SlugModuleService;