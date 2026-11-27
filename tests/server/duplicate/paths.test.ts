import { describe, expect, it } from 'vitest';
import {
  attributeAt,
  dropRelations,
  topLevelKeys,
} from '../../../server/src/services/modules/duplicate/domain/paths';
import { lookup } from './fixtures';

const PAGE = 'api::page.page';

describe('attributeAt', () => {
  it('resolves top-level, component, repeatable and dynamic zone paths', () => {
    const doc = { blocks: [{ __component: 'shared.text' }, { __component: 'shared.cta' }] };
    expect(attributeAt(PAGE, 'author', lookup, doc)?.target).toBe('api::author.author');
    expect(attributeAt(PAGE, 'seo.page', lookup, doc)?.target).toBe('api::page.page');
    expect(attributeAt(PAGE, 'ctas.1.page', lookup, doc)?.target).toBe('api::page.page');
    expect(attributeAt(PAGE, 'blocks.1.page', lookup, doc)?.target).toBe('api::page.page');
    expect(attributeAt(PAGE, 'blocks.0.page', lookup, doc)).toBeUndefined();
    expect(attributeAt(PAGE, 'nope', lookup, doc)).toBeUndefined();
    expect(attributeAt(PAGE, '__parent', lookup, doc)).toBeUndefined();
  });
});

describe('dropRelations', () => {
  const source = {
    author: { documentId: 'a1', locale: 'en' },
    related: [
      { documentId: 'p2', locale: 'en' },
      { documentId: 'p3', locale: 'en' },
    ],
    ctas: [{ label: 'Go', page: { documentId: 'p2' } }],
    blocks: [{ __component: 'shared.cta', page: { documentId: 'p3' } }],
  };

  it('removes only the named documents at their paths, without changing the input', () => {
    const out = dropRelations(source, [
      { path: 'author', documentId: 'a1' },
      { path: 'related', documentId: 'p2' },
      { path: 'ctas.0.page', documentId: 'p2' },
      { path: 'blocks.0.page', documentId: 'nope' },
    ]);
    expect(out.author).toBeNull();
    expect(out.related).toEqual([{ documentId: 'p3', locale: 'en' }]);
    expect(out.ctas[0]).toEqual({ label: 'Go', page: null });
    expect(out.blocks[0].page).toEqual({ documentId: 'p3' });
    expect(source.author).toEqual({ documentId: 'a1', locale: 'en' });
    expect(source.related).toHaveLength(2);
  });

  it('ignores paths that do not exist', () => {
    expect(dropRelations(source, [{ path: 'ctas.5.page', documentId: 'p2' }])).toEqual(source);
  });
});

describe('topLevelKeys', () => {
  it('gives the first segment of each path, once', () => {
    expect(topLevelKeys(['ctas.1.page', 'ctas.0.page', 'author', '__parent'])).toEqual(['ctas', 'author']);
  });
});
