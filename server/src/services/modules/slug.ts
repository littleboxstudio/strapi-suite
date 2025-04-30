import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs, SLUG_LANGUAGE_STRATEGY } from '../../config';
import { getSlugByDocumentId } from '../../utils/getSlugByDocumentId';
import { buildFullSlug } from '../../utils/buildFullSlug';
import { buildBreadcrumbs } from '../../utils/buildBreadcrumbs';
import { populateQueryFromContentType } from '../../utils/populateQueryFromContentType';
import { findDocumentIdsAndFetchSlugs } from '../../utils/findDocumentIdsAndFetchSlugs';

const SlugModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return [];
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        locale: ctx.query.locale,
        state: 'published',
      },
      orderBy: {
        id: 'desc',
      },
    });
    const publishedResults = [];
    for (const document of documents) {
      const content = await strapi.documents(document.contentModel).findOne({
        status: 'published',
        documentId: document.contentId,
        locale: ctx.query.locale as string,
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
      },
    });
    ctx.status = 204;
    return;
  },

  async getPage() {
    const ctx = strapi.requestContext.get();
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const slug = (<string>ctx.query.slug).replace(/^\/|\/$/g, '');
    const locales = await strapi.plugin('i18n').service('locales').find();
    const mappedLocales = locales.map((locale) => locale.code.toLowerCase());
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const settings = await strapi.db.query(config.uuid.app.setting).findMany({
      where: {
        module: 'slug',
        property: [
          'showDefaultLanguage',
          'homepageContentId',
          'homepageContentModel',
          'homepageSlugStrategy',
        ],
      },
    });
    const showDefaultLanguage =
      settings.find((setting) => setting.property === 'showDefaultLanguage').value === 'true';
    const homepageContentId = settings.find(
      (setting) => setting.property === 'homepageContentId'
    ).value;
    const homepageSlugStrategy = settings.find(
      (setting) => setting.property === 'homepageSlugStrategy'
    ).value;
    const homepageContentModel = settings.find(
      (setting) => setting.property === 'homepageContentModel'
    ).value;
    let page;
    if (homepageSlugStrategy === SLUG_LANGUAGE_STRATEGY && mappedLocales.includes(slug)) {
      page = await strapi.db.query(config.uuid.modules.slug).findOne({
        where: {
          state: 'published',
          contentId: homepageContentId,
          contentModel: homepageContentModel,
          locale: slug,
        },
      });
      page.fullSlug = slug;
    } else {
      const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
        where: {
          state: 'published',
          slug: slug.split('/'),
        },
      });
      pages.forEach((page) => {
        page.fullSlug = buildFullSlug({ pages, page, defaultLocale, showDefaultLanguage });
      });
      page = pages.find((page) => page.fullSlug === slug);
    }
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
          state: 'published',
        },
      });
      const template =
        attributes && attributes.templateId
          ? await strapi.db.query(config.uuid.modules.template).findOne({
              where: {
                documentId: attributes.templateId,
              },
            })
          : null;
      page.attributes = {
        template: template?.uid || 'default',
        priority: attributes?.priority || '0.5',
        frequency: attributes?.frequency || 'weekly',
        ...(attributes?.parentContentId
          ? { parent: { id: attributes.parentContentId, model: attributes.parentContentModel } }
          : {}),
      };
    }
    const query = populateQueryFromContentType(strapi, page.contentModel);
    const document = await strapi.documents(page.contentModel).findOne({
      locale: page.locale,
      populate: query,
      status: 'published',
      documentId: page.contentId,
    });
    await findDocumentIdsAndFetchSlugs({
      document, 
      defaultLocale,
      showDefaultLanguage,
      strapi
    });
    for (const localization of document.localizations) {
      if (
        homepageSlugStrategy === SLUG_LANGUAGE_STRATEGY &&
        localization.documentId === homepageContentId
      ) {
        localization.slug =
          localization.locale === defaultLocale ? '' : localization.locale.toLowerCase();
      } else {
        localization.slug = await getSlugByDocumentId({
          contentId: localization.documentId,
          locale: localization.locale,
          defaultLocale,
          showDefaultLanguage,
          strapi,
        });
      }
    }
    delete document.createdBy;
    delete document.updatedBy;
    document.slug = page.fullSlug;
    document.breadcrumbs = await buildBreadcrumbs({
      strapi,
      page,
      defaultLocale,
      showDefaultLanguage,
      homepageSlugStrategy,
      homepageContentId,
      homepageContentModel,
    });
    return {
      document,
      ...(page.attributes ? { attributes: page.attributes } : {}),
    };
  },

  async getPages() {
    const ctx = strapi.requestContext.get();
    const properties: any = ctx.query.properties;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const settings = await strapi.db.query(config.uuid.app.setting).findMany({
      where: {
        module: 'slug',
        property: [
          'showDefaultLanguage',
          'homepageContentId',
          'homepageContentModel',
          'homepageSlugStrategy',
        ],
      },
    });
    const showDefaultLanguage =
      settings.find((setting) => setting.property === 'showDefaultLanguage').value === 'true';
    const homepageContentId = settings.find(
      (setting) => setting.property === 'homepageContentId'
    ).value;
    const homepageContentModel = settings.find(
      (setting) => setting.property === 'homepageContentModel'
    ).value;
    const homepageSlugStrategy = settings.find(
      (setting) => setting.property === 'homepageSlugStrategy'
    ).value;
    const pages = await strapi.db.query(config.uuid.modules.slug).findMany({
      where: {
        state: 'published',
      },
    });
    pages.forEach((page) => {
      if (
        homepageContentId === page.contentId &&
        homepageContentModel === page.contentModel &&
        defaultLocale === page.locale
      ) {
        page.fullSlug = '';
      } else if (
        homepageContentId === page.contentId &&
        homepageContentModel === page.contentModel &&
        defaultLocale !== page.locale &&
        homepageSlugStrategy === SLUG_LANGUAGE_STRATEGY
      ) {
        page.fullSlug = page.locale.toLowerCase();
      } else {
        page.fullSlug = buildFullSlug({ pages, page, defaultLocale, showDefaultLanguage });
      }
    });
    if (properties && properties.includes('attributes')) {
      for (const page of pages) {
        const attributes = await strapi.db.query(config.uuid.modules.attribute).findOne({
          where: {
            locale: page.locale,
            contentId: page.contentId,
            contentModel: page.contentModel,
            state: 'published',
          },
        });
        const template =
          attributes && attributes.templateId
            ? await strapi.db.query(config.uuid.modules.template).findOne({
                where: {
                  documentId: attributes.templateId,
                },
              })
            : null;
        page.attributes = {
          template: template?.uid || 'default',
          priority: attributes?.priority || '0.5',
          frequency: attributes?.frequency || 'weekly',
          ...(attributes?.parentContentId
            ? { parent: { id: attributes.parentContentId, model: attributes.parentContentModel } }
            : {}),
        };
      }
    }
    const mappedPages = pages.map((page) => ({
      ...page,
      ...(page.attributes ? { attributes: page.attributes } : {}),
      localizations: [],
    }));
    const rootItems = mappedPages.filter((item) => item.locale === defaultLocale);
    const mappedItems: any[] = rootItems.map((rootItem) => {
      const relatedItems = mappedPages.filter(
        (item) =>
          item.contentId === rootItem.contentId &&
          item.contentModel === rootItem.contentModel &&
          item.locale !== defaultLocale
      );
      return {
        id: rootItem.id,
        documentId: rootItem.contentId,
        slug: rootItem.fullSlug,
        locale: rootItem.locale,
        createdAt: rootItem.updatedAt,
        updatedAt: rootItem.updatedAt,
        publishedAt: rootItem.updatedAt,
        ...(rootItem.attributes ? { attributes: rootItem.attributes } : {}),
        localizations: relatedItems.map((item) => ({
          id: item.id,
          documentId: item.contentId,
          slug: item.fullSlug,
          locale: item.locale,
          createdAt: item.updatedAt,
          updatedAt: item.updatedAt,
          publishedAt: item.updatedAt,
          ...(item.attributes ? { attributes: item.attributes } : {}),
        })),
      };
    });
    return mappedItems;
  },

  async getHomePage() {
    const ctx = strapi.requestContext.get();
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const settings = await strapi.db.query(config.uuid.app.setting).findMany({
      where: {
        module: 'slug',
        property: [
          'showDefaultLanguage',
          'homepageContentId',
          'homepageContentModel',
          'homepageSlugStrategy',
        ],
      },
    });
    const showDefaultLanguage =
      settings.find((setting) => setting.property === 'showDefaultLanguage').value === 'true';
    const homepageContentId = settings.find(
      (setting) => setting.property === 'homepageContentId'
    ).value;
    const homepageContentModel = settings.find(
      (setting) => setting.property === 'homepageContentModel'
    ).value;
    const homepageSlugStrategy = settings.find(
      (setting) => setting.property === 'homepageSlugStrategy'
    ).value;
    const page = await strapi.db.query(config.uuid.modules.slug).findOne({
      where: {
        state: 'published',
        contentId: homepageContentId,
        contentModel: homepageContentModel,
        locale: defaultLocale,
      },
    });
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
          state: 'published',
        },
      });
      const template =
        attributes && attributes.templateId
          ? await strapi.db.query(config.uuid.modules.template).findOne({
              where: {
                documentId: attributes.templateId,
              },
            })
          : null;
      page.attributes = {
        template: template?.uid || 'default',
        priority: attributes?.priority || '0.5',
        frequency: attributes?.frequency || 'weekly',
        ...(attributes?.parentContentId
          ? { parent: { id: attributes.parentContentId, model: attributes.parentContentModel } }
          : {}),
      };
    }
    const query = properties && properties.includes('content')
      ? populateQueryFromContentType(strapi, page.contentModel)
      : { localizations: { populate: '*' } };
    const document = await strapi.documents(page.contentModel).findOne({
      locale: page.locale,
      populate: query,
      status: 'published',
      documentId: page.contentId,
    });
    await findDocumentIdsAndFetchSlugs({
      document, 
      defaultLocale,
      showDefaultLanguage,
      strapi
    });
    for (const localization of document.localizations) {
      if (homepageSlugStrategy === SLUG_LANGUAGE_STRATEGY) {
        localization.slug =
          localization.locale === defaultLocale ? '' : localization.locale.toLowerCase();
      } else {
        localization.slug = await getSlugByDocumentId({
          contentId: localization.documentId,
          locale: localization.locale,
          defaultLocale,
          showDefaultLanguage,
          strapi,
        });
      }
    }
    delete document.createdBy;
    delete document.updatedBy;
    document.slug = '';
    document.breadcrumbs = [
      {
        position: 1,
        name: document.title,
        item: '',
      },
    ];
    return {
      document,
      ...(page.attributes ? { attributes: page.attributes } : {}),
    };
  },
});

export default SlugModuleService;
