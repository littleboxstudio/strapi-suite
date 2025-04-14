import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';
import { getSlugByDocumentId } from '../../utils/getSlugByDocumentId';

function findItem(params: { pages, contentId, contentModel, locale }) {
  return params.pages.find(page => 
    page.contentId === params.contentId
    && page.contentModel === params.contentModel
    && page.locale === params.locale
  );
}

function buildFullSlug(params: { pages, page, defaultLocale, showDefaultLanguage }) {
  if (!params.page.parentContentId || !params.page.parentContentModel) { 
    return (params.showDefaultLanguage || (!params.showDefaultLanguage && params.defaultLocale !== params.page.locale))
      ? `${params.page.locale.toLowerCase()}/${params.page.slug}`
      : params.page.slug
  };
  const parent = findItem({
    pages: params.pages,
    contentId: params.page.parentContentId,
    contentModel: params.page.parentContentModel,
    locale: params.page.locale
  });
  if (!parent) { 
    return params.page.slug
  }; 
  const parentFullSlug = parent.fullSlug || buildFullSlug({
    pages: params.pages,
    page: parent,
    defaultLocale: params.defaultLocale, 
    showDefaultLanguage: params.showDefaultLanguage
  });
  return `${parentFullSlug}/${params.page.slug}`;
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
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const slug = (<string>ctx.query.slug).replace(/^\/|\/$/g, '');
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module: 'slug',
        property: 'showDefaultLanguage'
      } 
    });
    const showDefaultLanguage = setting.value === "true";
    const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        state: "published",
        slug: slug.split("/")
      }
    });
    pages.forEach(page => {
      page.fullSlug = buildFullSlug({ pages, page, defaultLocale, showDefaultLanguage });
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
    const document = await strapi.documents(page.contentModel).findOne({
      locale: page.locale,
      populate: '*',
      status: 'published',
      documentId: page.contentId,
    });
    for(const localization of document.localizations) { 
      localization.slug = await getSlugByDocumentId({
        contentId: localization.documentId,
        locale: localization.locale,
        defaultLocale,
        showDefaultLanguage,
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
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module: 'slug',
        property: 'showDefaultLanguage'
      } 
    });
    const showDefaultLanguage = setting.value === "true";
    const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        state: "published"
      }
    });
    pages.forEach(page => {
      page.fullSlug = buildFullSlug({ pages, page, defaultLocale, showDefaultLanguage });
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
      locale: page.locale,
      ...(page.attributes ? { attributes: page.attributes } : {})
    }));
    return mappedPages;
  }
});

export default SlugModuleService;