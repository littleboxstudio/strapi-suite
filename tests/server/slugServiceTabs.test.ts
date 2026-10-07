import { describe, it, expect, vi, beforeEach } from 'vitest';
import SlugModuleService from '../../server/src/services/modules/slug';

const KEY = 'littlebox-strapi-suite';
const pageContentType = {
  pluginOptions: {
    [KEY]: {
      tabs: [
        { id: 't1', name: 'Teste 1' },
        { id: 't2', name: 'Teste 2' },
      ],
    },
  },
  attributes: {
    title: { type: 'string' },
    capitulo: { type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
    autor: { type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
  },
};

function makeStrapi(query: Record<string, unknown> = {}) {
  const settings = [
    { property: 'showDefaultLanguage', value: 'false' },
    { property: 'homepageContentId', value: 'doc1' },
    { property: 'homepageContentModel', value: 'api::page.page' },
    { property: 'homepageSlugStrategy', value: 'content' },
  ];
  const page = { contentId: 'doc1', contentModel: 'api::page.page', locale: 'en', slug: 'sobre' };
  const document = {
    id: 13,
    documentId: 'doc1',
    title: 'Homepage',
    capitulo: 'c',
    autor: 'a',
    locale: 'en',
    localizations: [],
  };
  return {
    requestContext: { get: () => ({ query, status: 200 }) },
    config: {
      get: () => ({
        uuid: {
          app: { setting: 'setting' },
          modules: { slug: 'slug', attribute: 'attribute', template: 'template' },
        },
      }),
    },
    plugin: () => ({
      service: () => ({ getDefaultLocale: async () => 'en', find: async () => [{ code: 'en' }] }),
    }),
    db: {
      query: (uid: string) => ({
        findMany: async () => (uid === 'setting' ? settings : uid === 'slug' ? [{ ...page }] : []),
        findOne: async () => (uid === 'slug' ? { ...page } : null),
      }),
    },
    documents: () => ({ findOne: async () => ({ ...document }) }),
    contentTypes: { 'api::page.page': pageContentType },
    contentType: (uid: string) => (uid === 'api::page.page' ? pageContentType : undefined),
    log: { warn: vi.fn(), error: vi.fn() },
  };
}

describe('SlugModuleService — tabs', () => {
  beforeEach(() => {
    (globalThis as any).strapi = makeStrapi();
  });

  it('getHomePage devolve o documento agrupado por tabs', async () => {
    const service = SlugModuleService({ strapi: (globalThis as any).strapi });
    const result: any = await service.getHomePage();
    expect(result.document).toMatchObject({
      id: 13,
      title: 'Homepage',
      slug: '',
      teste_1: { capitulo: 'c' },
      teste_2: { autor: 'a' },
    });
    expect(result.document).not.toHaveProperty('capitulo');
    expect(result.document).not.toHaveProperty('autor');
  });

  it('getPage devolve o documento agrupado por tabs', async () => {
    (globalThis as any).strapi = makeStrapi({ slug: 'sobre' });
    const service = SlugModuleService({ strapi: (globalThis as any).strapi });
    const result: any = await service.getPage();
    expect(result.document).toMatchObject({
      title: 'Homepage',
      slug: 'sobre',
      teste_1: { capitulo: 'c' },
      teste_2: { autor: 'a' },
    });
    expect(result.document).not.toHaveProperty('capitulo');
  });
});
