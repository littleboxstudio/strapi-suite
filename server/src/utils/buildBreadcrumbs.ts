import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs, SLUG_CONTENT_STRATEGY } from '../config';

export async function build(params: {
  strapi: Core.Strapi;
  page;
  defaultLocale;
  showDefaultLanguage;
}) {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const document = await strapi.documents(params.page.contentModel).findOne({
    locale: params.page.locale,
    status: 'published',
    documentId: params.page.contentId,
  });
  if (!params.page.parentContentId || !params.page.parentContentModel) {
    return [
      {
        name: document.title,
        slug: params.page.slug,
      },
    ];
  }
  const parentPage = await strapi.db.query(config.uuid.modules.slug).findOne({
    where: {
      state: 'published',
      contentId: params.page.parentContentId,
      contentModel: params.page.parentContentModel,
      locale: params.page.locale,
    },
  });
  const parentBreadcrumb = await build({
    strapi: params.strapi,
    page: parentPage,
    defaultLocale: params.defaultLocale,
    showDefaultLanguage: params.showDefaultLanguage,
  });
  return [
    ...parentBreadcrumb,
    {
      name: document.title,
      slug: params.page.slug,
    },
  ];
}

export async function buildBreadcrumbs(params: {
  strapi: Core.Strapi;
  page;
  defaultLocale;
  showDefaultLanguage;
  homepageSlugStrategy;
  homepageContentId;
  homepageContentModel;
}) {
  const isHomepage =
    params.page.contentId === params.homepageContentId &&
    params.page.contentModel === params.homepageContentModel;
  const result = await build({
    strapi: params.strapi,
    page: params.page,
    defaultLocale: params.defaultLocale,
    showDefaultLanguage: params.showDefaultLanguage,
  });
  if (isHomepage) {
    result[0].slug = '';
    if (params.defaultLocale !== params.page.locale) {
      result[0].slug =
        params.homepageSlugStrategy === SLUG_CONTENT_STRATEGY
          ? `${params.page.locale.toLowerCase()}/${params.page.slug}`
          : params.page.locale.toLowerCase();
    }
  }
  if (!isHomepage) {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const page = await strapi.db.query(config.uuid.modules.slug).findOne({
      where: {
        locale: params.page.locale,
        contentId: params.homepageContentId,
        contentModel: params.homepageContentModel,
        state: 'published',
      },
    });
    const document = await strapi.documents(params.homepageContentModel).findOne({
      locale: params.page.locale,
      status: 'published',
      documentId: params.homepageContentId,
    });
    let slug = '';
    if (params.defaultLocale !== params.page.locale) {
      slug =
        params.homepageSlugStrategy === SLUG_CONTENT_STRATEGY
          ? `${params.page.locale.toLowerCase()}/${page.slug}`
          : params.page.locale.toLowerCase();
    }
    result.unshift({
      name: document.title,
      slug,
    });
  }
  const mappedResult = result.reduce((acc, currentItem, index) => {
    const mappedItem = {
      position: index + 1,
      item: currentItem.slug,
      name: currentItem.name,
    };
    if (index === 1 && params.defaultLocale === params.page.locale) {
      mappedItem.item = params.showDefaultLanguage
        ? `${params.page.locale}/${currentItem.slug}`
        : currentItem.slug;
    }
    if (index === 1 && params.defaultLocale !== params.page.locale) {
      mappedItem.item = `${params.page.locale}/${currentItem.slug}`;
    }
    if (index > 1) {
      mappedItem.item = `${acc[index - 1].item}/${currentItem.slug}`;
    }
    acc.push(mappedItem);
    return acc;
  }, []);
  return mappedResult;
}
