import { describe, it, expect } from 'vitest';
import {
  applyStrings,
  collectStrings,
  convertToSlug,
  toAiStrings,
} from '../../../server/src/services/modules/duplicate/domain/strings';
import { convertToSlug as adminConvertToSlug } from '../../../admin/src/core/utils/convertToSlug';
import { lookup } from './fixtures';

const source = {
  documentId: 'p1',
  title: 'About us',
  slug: 'about-us',
  code: 'NOT-LOCALIZED',
  link: 'https://example.com/a',
  body: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', bold: true },
        { type: 'link', url: 'https://x.y', children: [{ type: 'text', text: '/path' }] },
      ],
    },
  ],
  seo: { id: 1, metaTitle: 'Meta', metaDescription: '   ' },
  ctas: [
    { id: 2, label: 'Read', url: '/contact', inner: { note: '<p>Note</p>' } },
    { id: 3, label: 'mailto:a@b.c' },
  ],
  blocks: [
    { __component: 'shared.text', id: 4, content: 'Rich', handle: 'rich-text' },
    { __component: 'shared.unknown', id: 5, content: 'Skipped' },
  ],
  shared: { id: 6, metaTitle: 'Shared not localized' },
};

describe('collectStrings', () => {
  const fields = collectStrings('api::page.page', source, lookup);

  it('collects text, blocks, components and dynamic zones with their paths', () => {
    expect(fields).toEqual([
      { path: 'title', value: 'About us', kind: 'text' },
      { path: 'slug', value: 'about-us', kind: 'slug' },
      { path: 'body.0.children.0.text', value: 'Hello ', kind: 'text' },
      { path: 'body.0.children.1.text', value: 'world', kind: 'text' },
      { path: 'seo.metaTitle', value: 'Meta', kind: 'text' },
      { path: 'ctas.0.label', value: 'Read', kind: 'text' },
      { path: 'ctas.0.inner.note', value: '<p>Note</p>', kind: 'text' },
      { path: 'blocks.0.content', value: 'Rich', kind: 'text' },
      { path: 'blocks.0.handle', value: 'rich-text', kind: 'slug' },
    ]);
  });

  it('skips URLs, blank values, not localized attributes and unknown components', () => {
    const paths = fields.map((f) => f.path);
    expect(paths).not.toContain('link');
    expect(paths).not.toContain('code');
    expect(paths).not.toContain('ctas.0.url');
    expect(paths).not.toContain('ctas.1.label');
    expect(paths).not.toContain('seo.metaDescription');
    expect(paths).not.toContain('body.0.children.2.children.0.text');
    expect(paths.some((p) => p.startsWith('shared'))).toBe(false);
    expect(paths.some((p) => p.startsWith('blocks.1'))).toBe(false);
  });

  it('a uid is a slug', () => {
    expect(collectStrings('api::author.author', { name: 'Ann', handle: 'ann-lee' }, lookup)).toEqual([
      { path: 'name', value: 'Ann', kind: 'text' },
      { path: 'handle', value: 'ann-lee', kind: 'slug' },
    ]);
  });

  it('an unknown type or missing data has nothing to translate', () => {
    expect(collectStrings('api::nope.nope', source, lookup)).toEqual([]);
    expect(collectStrings('api::page.page', null, lookup)).toEqual([]);
  });
});

describe('toAiStrings / applyStrings', () => {
  const fields = [
    { path: 'title', value: 'About us', kind: 'text' as const },
    { path: 'slug', value: 'about-us', kind: 'slug' as const },
    { path: 'ctas.0.label', value: 'Read', kind: 'text' as const },
    { path: 'body.0.children.1.text', value: 'world', kind: 'text' as const },
  ];

  it('keys by index and sends slugs as words', () => {
    expect(toAiStrings(fields)).toEqual({ '0': 'About us', '1': 'about us', '2': 'Read', '3': 'world' });
  });

  it('writes the translations at their paths without touching the input', () => {
    const data = {
      title: 'About us',
      ctas: [{ label: 'Read', url: '/x' }],
      body: [{ type: 'paragraph', children: [{ text: 'Hello ' }, { text: 'world' }] }],
    };
    const before = JSON.parse(JSON.stringify(data));
    const out = applyStrings(data, fields, { '0': 'Sobre nós', '1': 'Sobre Nós', '2': 'Ler', '3': 'mundo' });
    expect(out.failed).toBe(0);
    expect(out.data).toEqual({
      title: 'Sobre nós',
      slug: 'sobre-nos',
      ctas: [{ label: 'Ler', url: '/x' }],
      body: [{ type: 'paragraph', children: [{ text: 'Hello ' }, { text: 'mundo' }] }],
    });
    expect(data).toEqual(before);
  });

  it('a missing or blank translation keeps the source and counts as failed', () => {
    const data = { title: 'About us', ctas: [{ label: 'Read' }], body: [{ children: [{}, { text: 'world' }] }] };
    const out = applyStrings(data, fields, { '0': '  ', '2': 'Ler', '1': '!!!' });
    expect(out.failed).toBe(3);
    expect(out.data.title).toBe('About us');
    expect(out.data.slug).toBe('about-us');
    expect(out.data.ctas[0].label).toBe('Ler');
    expect(out.data.body[0].children[1].text).toBe('world');
  });

  it('a path whose container is gone is not created', () => {
    const out = applyStrings({ title: 'x' }, fields, { '0': 'a', '1': 'b', '2': 'c', '3': 'd' });
    expect(out.data).toEqual({ title: 'a', slug: 'b' });
  });
});

describe('convertToSlug (server copy)', () => {
  it('matches the admin rule', () => {
    for (const text of ['About Us', '  --Coração & Alma!--  ', 'about-', '', 'Summer Sale 2026 ', 'a'.repeat(120)]) {
      expect(convertToSlug(text)).toBe(adminConvertToSlug(text));
    }
    expect(convertToSlug('Hello big world', 9)).toBe(adminConvertToSlug('Hello big world', 9));
  });
});
