import { describe, it, expect } from 'vitest';
import {
  collectLocalizedRelations,
  deepPopulate,
  isLocalizedApiType,
  isLocalizedAttribute,
  listScope,
} from '../../../server/src/services/modules/duplicate/domain/scope';
import { contentTypes, lookup } from './fixtures';

describe('duplicate scope', () => {
  it('a localized api type is in scope; plugin, not localized and Strapi types are not', () => {
    expect(isLocalizedApiType('api::page.page', contentTypes['api::page.page'])).toBe(true);
    expect(isLocalizedApiType('api::tag.tag', contentTypes['api::tag.tag'])).toBe(false);
    expect(isLocalizedApiType('api::plain.plain', contentTypes['api::plain.plain'])).toBe(false);
    expect(
      isLocalizedApiType(
        'plugin::littlebox-strapi-suite.ltb-st-module-slug-item',
        contentTypes['plugin::littlebox-strapi-suite.ltb-st-module-slug-item']
      )
    ).toBe(false);
    expect(isLocalizedApiType('api::missing.missing', undefined)).toBe(false);
  });

  it('lists the scope sorted by uid, with kind and draft & publish', () => {
    expect(listScope(contentTypes)).toEqual([
      { uid: 'api::author.author', kind: 'collectionType', draftAndPublish: false },
      { uid: 'api::home.home', kind: 'singleType', draftAndPublish: true },
      { uid: 'api::page.page', kind: 'collectionType', draftAndPublish: true },
    ]);
  });

  it('an attribute is localized as Strapi i18n decides: the option, or any relation / uid', () => {
    expect(isLocalizedAttribute({ type: 'string', pluginOptions: { i18n: { localized: true } } })).toBe(true);
    expect(isLocalizedAttribute({ type: 'string', pluginOptions: { i18n: { localized: false } } })).toBe(false);
    expect(isLocalizedAttribute({ type: 'string' })).toBe(false);
    expect(isLocalizedAttribute({ type: 'relation', target: 'api::tag.tag' })).toBe(true);
    expect(isLocalizedAttribute({ type: 'uid' })).toBe(true);
  });
});

describe('collectLocalizedRelations', () => {
  const doc = {
    id: 1,
    documentId: 'p1',
    title: 'Home',
    author: { id: 3, documentId: 'a1', locale: 'en' },
    tags: [{ id: 9, documentId: 't1' }],
    related: [
      { id: 4, documentId: 'p2', locale: 'en' },
      { id: 5, documentId: 'p3', locale: 'en' },
    ],
    seo: { id: 10, metaTitle: 'x', page: { documentId: 'p4' }, tag: { documentId: 't2' } },
    ctas: [
      { id: 11, label: 'a', page: null },
      { id: 12, label: 'b', page: { documentId: 'p5' } },
    ],
    blocks: [
      { __component: 'shared.text', id: 13, content: 'hi' },
      { __component: 'shared.cta', id: 14, page: { documentId: 'p6' } },
    ],
    shared: { id: 15, page: { documentId: 'p7' } },
    createdBy: { id: 1 },
  };

  it('finds localized relations at the top level, in components and dynamic zones', () => {
    expect(collectLocalizedRelations('api::page.page', doc, lookup)).toEqual([
      { path: 'author', targetUid: 'api::author.author', documentId: 'a1' },
      { path: 'related', targetUid: 'api::page.page', documentId: 'p2' },
      { path: 'related', targetUid: 'api::page.page', documentId: 'p3' },
      { path: 'seo.page', targetUid: 'api::page.page', documentId: 'p4' },
      { path: 'ctas.1.page', targetUid: 'api::page.page', documentId: 'p5' },
      { path: 'blocks.1.page', targetUid: 'api::page.page', documentId: 'p6' },
    ]);
  });

  it('skips not localized targets, empty values, inverse sides and not localized components', () => {
    const refs = collectLocalizedRelations('api::page.page', doc, lookup);
    expect(refs.some((r) => r.targetUid === 'api::tag.tag')).toBe(false);
    expect(refs.some((r) => r.path.startsWith('shared'))).toBe(false);
    expect(
      collectLocalizedRelations('api::author.author', { pages: [{ documentId: 'p1' }] }, lookup)
    ).toEqual([]);
    expect(collectLocalizedRelations('api::page.page', { author: null, related: [] }, lookup)).toEqual([]);
    expect(collectLocalizedRelations('api::unknown.unknown', doc, lookup)).toEqual([]);
  });
});

describe('deepPopulate', () => {
  it('nests components, dynamic zones, relations and media; skips audit relations', () => {
    expect(deepPopulate('api::page.page', lookup)).toEqual({
      cover: true,
      gallery: true,
      author: { fields: ['documentId', 'locale'] },
      tags: { fields: ['documentId'] },
      related: { fields: ['documentId', 'locale'] },
      seo: {
        populate: {
          page: { fields: ['documentId', 'locale'] },
          tag: { fields: ['documentId'] },
        },
      },
      ctas: {
        populate: {
          page: { fields: ['documentId', 'locale'] },
          icon: true,
          inner: true,
        },
      },
      blocks: {
        on: {
          'shared.cta': {
            populate: {
              page: { fields: ['documentId', 'locale'] },
              icon: true,
              inner: true,
            },
          },
          'shared.text': true,
        },
      },
      shared: {
        populate: {
          page: { fields: ['documentId', 'locale'] },
          tag: { fields: ['documentId'] },
        },
      },
    });
  });

  it('a type without populatable attributes gives an empty populate; inverse sides are not populated', () => {
    expect(deepPopulate('api::home.home', lookup)).toEqual({});
    expect(deepPopulate('api::author.author', lookup)).toEqual({});
    expect(deepPopulate('api::missing.missing', lookup)).toEqual({});
  });
});
