import { describe, it, expect } from 'vitest';
import { mapData, slugFieldOf } from '../../../server/src/services/modules/duplicate/domain/mapData';
import { lookup } from './fixtures';

const image = { fileId: 7, alt: 'x', crops: [{ w: 10 }] };

const source = {
  id: 1,
  documentId: 'p1',
  locale: 'en',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  publishedAt: null,
  createdBy: { id: 1 },
  updatedBy: { id: 1 },
  localizations: [],
  title: 'Home',
  slug: 'home',
  code: 'SHARED',
  body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }],
  link: '',
  image,
  cover: { id: 50, url: '/a.png' },
  gallery: [
    { id: 51, url: '/b.png' },
    { id: 52, url: '/c.png' },
  ],
  author: { id: 3, documentId: 'a1', locale: 'en' },
  tags: [{ id: 9, documentId: 't1' }, { id: 10, documentId: 't2' }],
  related: [],
  seo: { id: 20, metaTitle: 'Meta', metaDescription: null, page: { documentId: 'p2' }, tag: null },
  ctas: [
    { id: 21, label: 'A', url: '/a', page: { documentId: 'p3' }, icon: { id: 60 }, inner: { id: 30, note: 'n' } },
    { id: 22, label: 'B', url: null, page: { documentId: 'p4' }, icon: null, inner: null },
  ],
  blocks: [
    { __component: 'shared.text', id: 23, content: 'Rich', handle: 'rich' },
    { __component: 'shared.cta', id: 24, label: 'C', page: { documentId: 'p5' }, icon: { id: 61 } },
  ],
  shared: { id: 25, metaTitle: 'not localized' },
};

describe('mapData', () => {
  const data = mapData('api::page.page', source, lookup, {});

  it('drops system fields, not localized attributes and the slug field', () => {
    for (const key of [
      'id',
      'documentId',
      'locale',
      'createdAt',
      'updatedAt',
      'publishedAt',
      'createdBy',
      'updatedBy',
      'localizations',
      'code',
      'shared',
      'slug',
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('copies scalars, blocks and the image field as they are', () => {
    expect(data.title).toBe('Home');
    expect(data.body).toEqual(source.body);
    expect(data.image).toEqual(image);
    expect(data.image).not.toBe(image);
  });

  it('media become ids; relations become documentIds', () => {
    expect(data.cover).toBe(50);
    expect(data.gallery).toEqual([51, 52]);
    expect(data.author).toBe('a1');
    expect(data.tags).toEqual(['t1', 't2']);
  });

  it('components and dynamic zone entries lose their ids and keep __component', () => {
    expect(data.seo).toEqual({ metaTitle: 'Meta', metaDescription: null, page: 'p2', tag: null });
    expect(data.ctas).toEqual([
      { label: 'A', url: '/a', page: 'p3', icon: 60, inner: { note: 'n' } },
      { label: 'B', url: null, page: 'p4', icon: null, inner: null },
    ]);
    expect(data.blocks).toEqual([
      { __component: 'shared.text', content: 'Rich', handle: 'rich' },
      { __component: 'shared.cta', label: 'C', page: 'p5', icon: 61 },
    ]);
  });

  it('empty values are left out unless replacing', () => {
    expect(data).not.toHaveProperty('link');
    expect(data).not.toHaveProperty('related');
  });

  it('deferred relations are left empty, at the top level and inside a repeatable component', () => {
    const out = mapData('api::page.page', source, lookup, { deferred: ['author', 'related', 'ctas.1.page', 'blocks.1.page'] });
    expect(out.author).toBeNull();
    expect(out.ctas[0].page).toBe('p3');
    expect(out.ctas[1].page).toBeNull();
    expect(out.blocks[1].page).toBeNull();
    expect(out.related).toEqual([]);
    expect(out.tags).toEqual(['t1', 't2']);
  });

  it('replace writes empty attributes as null or [] so the target is a true copy', () => {
    const out = mapData(
      'api::page.page',
      { title: '', body: null, cover: null, gallery: [], author: null, related: [], blocks: [] },
      lookup,
      { replace: true }
    );
    expect(out).toEqual({
      title: null,
      body: null,
      link: null,
      image: null,
      cover: null,
      gallery: [],
      author: null,
      tags: [],
      related: [],
      seo: null,
      ctas: [],
      blocks: [],
    });
  });

  it('does not write inverse sides of relations', () => {
    const out = mapData('api::author.author', { name: 'Ann', handle: 'ann', pages: [{ documentId: 'p1' }] }, lookup, {
      replace: true,
    });
    expect(out).toEqual({ name: 'Ann', handle: 'ann' });
  });

  it('an unknown type maps to nothing', () => {
    expect(mapData('api::nope.nope', source, lookup, {})).toEqual({});
  });
});

describe('slugFieldOf', () => {
  it('finds the Littlebox slug attribute', () => {
    expect(slugFieldOf('api::page.page', lookup)).toBe('slug');
    expect(slugFieldOf('api::author.author', lookup)).toBeNull();
    expect(slugFieldOf('api::nope.nope', lookup)).toBeNull();
  });
});
