import { describe, it, expect, vi } from 'vitest';
import { createContentTypeTabsGrouper } from '../../server/src/utils/groupByContentTypeTabs';

const KEY = 'littlebox-strapi-suite';
const contentType = {
  pluginOptions: {
    [KEY]: {
      tabs: [
        { id: 't1', name: 'Teste 1' },
        { id: 't2', name: 'Title' },
      ],
    },
  },
  attributes: {
    title: { type: 'string' },
    capitulo: { type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
    other: { type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
  },
};

function makeStrapi(
  getContentType: (uid: string) => unknown = (uid) =>
    uid === 'api::page.page' ? contentType : undefined
) {
  return { contentType: vi.fn(getContentType), log: { warn: vi.fn(), error: vi.fn() } };
}

describe('createContentTypeTabsGrouper', () => {
  it('agrupa um documento (formato do módulo de slugs) e avisa conflitos uma única vez', () => {
    const strapi = makeStrapi();
    const group = createContentTypeTabsGrouper(strapi as any);
    const document = {
      id: 13,
      title: 'Homepage',
      capitulo: 'c',
      other: 'o',
      slug: '',
      breadcrumbs: [],
    };
    expect(group('api::page.page', document)).toEqual({
      id: 13,
      title: 'Homepage',
      other: 'o',
      slug: '',
      breadcrumbs: [],
      teste_1: { capitulo: 'c' },
    });
    group('api::page.page', document);
    expect(strapi.log.warn).toHaveBeenCalledTimes(1);
  });

  it('devolve os dados originais para content types sem tabs ou desconhecidos', () => {
    const strapi = makeStrapi();
    const group = createContentTypeTabsGrouper(strapi as any);
    const data = { id: 1 };
    expect(group('api::other.other', data)).toBe(data);
  });

  it('devolve os dados originais e registra erro se o agrupamento falhar', () => {
    const strapi = makeStrapi(() => {
      throw new Error('boom');
    });
    const group = createContentTypeTabsGrouper(strapi as any);
    const data = { id: 1 };
    expect(group('api::page.page', data)).toBe(data);
    expect(strapi.log.error).toHaveBeenCalledTimes(1);
  });
});
