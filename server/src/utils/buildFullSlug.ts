function findItem(params: { pages, contentId, contentModel, locale }) {
  return params.pages.find(page => 
    page.contentId === params.contentId
    && page.contentModel === params.contentModel
    && page.locale === params.locale
  );
}

export function buildFullSlug(params: { pages, page, defaultLocale, showDefaultLanguage }) {
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