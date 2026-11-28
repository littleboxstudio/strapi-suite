import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../ecommerce/helpers/fakeDb';
import { createFakeDocuments } from './helpers/fakeDocuments';
import { components, contentTypes, lookup } from './fixtures';
import DuplicateRunService from '../../../server/src/services/modules/duplicate/runs';
import DuplicateService from '../../../server/src/services/modules/duplicate/runner';

const P = 'plugin::littlebox-strapi-suite.';
const SETTING = `${P}ltb-st-app-setting`;
const SLUG = `${P}ltb-st-module-slug-item`;
const ATTR = `${P}ltb-st-module-attribute-item`;
const RUN = `${P}ltb-st-module-duplicate-run`;
const E = `${P}ltb-st-module-ecommerce-`;
const EU = {
  product: `${E}product`,
  productTranslation: `${E}product-translation`,
  variant: `${E}variant`,
  variantTranslation: `${E}variant-translation`,
  category: `${E}product-category`,
  categoryTranslation: `${E}product-category-translation`,
  tag: `${E}product-tag`,
  tagTranslation: `${E}product-tag-translation`,
  collection: `${E}collection`,
  collectionTranslation: `${E}collection-translation`,
  emailTemplate: `${E}email-template`,
};
const PAGE = 'api::page.page';
const AUTHOR = 'api::author.author';
const HOME = 'api::home.home';

const page = (over: any = {}) => ({
  title: 'About',
  slug: 'about-us',
  code: 'X',
  link: '/about',
  related: [],
  tags: [],
  ...over,
});

const setup = () => {
  const db = createFakeDb([SETTING, SLUG, ATTR, RUN, ...Object.values(EU)], {
    [EU.product]: { translations: [EU.productTranslation, 'product'] },
    [EU.variant]: { translations: [EU.variantTranslation, 'variant'] },
    [EU.category]: { translations: [EU.categoryTranslation, 'category'] },
    [EU.tag]: { translations: [EU.tagTranslation, 'tag'] },
    [EU.collection]: { translations: [EU.collectionTranslation, 'collection'] },
  });
  const docs = createFakeDocuments(lookup);
  const ai = {
    getCredentials: vi.fn(async (): Promise<any> => ({ apiKey: 'sk-test', model: 'gpt-4o' })),
    translateStrings: vi.fn(async (_c: any, _s: any, target: any, strings: Record<string, string>) => ({
      translations: Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, `[${target.code}] ${v}`])),
      failed: 0,
      errors: [],
    })),
  };
  const email = {
    list: vi.fn(async (): Promise<any[]> => []),
    get: vi.fn(),
    save: vi.fn(async () => ({})),
  };
  const locales = {
    find: vi.fn(async () => [
      { code: 'en', name: 'English' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'fr', name: 'French' },
    ]),
    getDefaultLocale: vi.fn(async () => 'en'),
  };
  const services: Record<string, any> = {};
  const strapi: any = {
    contentTypes,
    components,
    documents: docs.documents,
    db,
    config: {
      get: () => ({
        uuid: {
          app: { setting: SETTING },
          modules: { slug: SLUG, attribute: ATTR, duplicateRun: RUN, ecommerce: EU },
        },
      }),
    },
    plugin: (id: string) => ({ service: (name: string) => (id === 'i18n' ? locales : services[name]) }),
    log: { warn: vi.fn(), error: vi.fn() },
  };
  services.DuplicateRunService = DuplicateRunService({ strapi });
  services.AiTranslationModuleService = ai;
  services.EcommerceEmailTemplateService = email;
  const svc = DuplicateService({ strapi });
  const run = async (opts: any = {}) => {
    const { runId } = await svc.start(
      { targetLocale: 'pt', existing: 'skip', status: 'follow', ecommerce: false, ...opts },
      { id: 7, name: 'Ana Admin' }
    );
    await svc.whenIdle();
    return (await services.DuplicateRunService.list()).find((r: any) => r.id === runId);
  };
  const updates = (uid?: string) =>
    docs.writes('update').filter((c) => !uid || c.uid === uid).map((c) => ({ id: c.params.documentId, data: c.params.data }));
  return { db, docs, ai, email, strapi, svc, run, updates, runs: services.DuplicateRunService };
};

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

describe('DuplicateService — ordering', () => {
  it('writes a dependency before the content that relates to it, pointing at the same documentId', async () => {
    t.docs.seed(AUTHOR, 'a1', 'en', 'draft', { name: 'Ann', handle: 'ann' });
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ author: { documentId: 'a1', locale: 'en' } }));
    const run = await t.run({ status: 'draft' });
    expect(run.status).toBe('SUCCESS');
    expect(t.docs.writes('update').map((c) => `${c.uid}#${c.params.documentId}`)).toEqual([
      `${AUTHOR}#a1`,
      `${PAGE}#p1`,
    ]);
    const [, pageWrite] = t.updates();
    expect(pageWrite.data.author).toBe('a1');
    expect(pageWrite.data.title).toBe('[pt] About');
    expect(pageWrite.data.link).toBe('/about');
    expect(pageWrite.data).not.toHaveProperty('code');
    expect(pageWrite.data).not.toHaveProperty('slug');
    expect(pageWrite.data.ltb_slug).toBe('pt-about-us');
    expect(t.updates(AUTHOR)[0].data).toEqual({ name: '[pt] Ann', handle: 'pt-ann' });
    expect(run.counts).toEqual({ duplicated: 2, replaced: 0, skipped: 0, untranslated: 0, failed: 0 });
    expect(run.progress).toEqual({ total: 2, done: 2, current: null });
    expect(run.userId).toBe('7');
    expect(run.userName).toBe('Ana Admin');
  });

  it('a cycle creates one side without the relation, then sets it', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ related: [{ documentId: 'p2', locale: 'en' }] }));
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ title: 'Two', slug: 'two', related: [{ documentId: 'p1', locale: 'en' }] }));
    const run = await t.run({ status: 'draft' });
    expect(run.counts.failed).toBe(0);
    expect(run.failures).toEqual([]);
    expect(t.updates().map((u) => [u.id, u.data.related])).toEqual([
      ['p1', []],
      ['p2', ['p1']],
      ['p1', ['p2']],
    ]);
    // The fix sends only the attribute it sets.
    expect(Object.keys(t.updates()[2].data)).toEqual(['related']);
    expect(t.docs.get(PAGE, 'p1', 'pt').related).toEqual(['p2']);
  });

  it('a relation to itself is created empty, then set', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ related: [{ documentId: 'p1', locale: 'en' }] }));
    await t.run({ status: 'draft' });
    expect(t.updates().map((u) => u.data.related)).toEqual([[], ['p1']]);
  });

  it('a cycle closed inside a component re-sends the whole component, translated', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ ctas: [{ label: 'Go', url: '/x', page: { documentId: 'p2' } }] }));
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ title: 'Two', slug: 'two', seo: { metaTitle: 'Meta', page: { documentId: 'p1' } } }));
    const run = await t.run({ status: 'draft' });
    expect(run.failures).toEqual([]);
    const [first, second, fix] = t.updates();
    expect(first.id).toBe('p1');
    expect(first.data.ctas).toEqual([{ label: '[pt] Go', url: '/x', page: null }]);
    expect(second.data.seo).toEqual({ metaTitle: '[pt] Meta', page: 'p1' });
    // The fix writes the whole component (absent fields as null: components are replaced whole).
    expect(fix).toEqual({
      id: 'p1',
      data: { ctas: [{ label: '[pt] Go', url: '/x', page: 'p2', icon: null, inner: null }] },
    });
  });

  it('a published cycle member is published again after its fix (follow)', async () => {
    for (const status of ['draft', 'published'] as const) {
      t.docs.seed(PAGE, 'p1', 'en', status, page({ related: [{ documentId: 'p2', locale: 'en' }] }));
      t.docs.seed(PAGE, 'p2', 'en', status, page({ title: 'Two', slug: 'two', related: [{ documentId: 'p1', locale: 'en' }] }));
    }
    await t.run({ status: 'follow' });
    expect(t.docs.writes().map((c) => `${c.action} ${c.params.documentId}`)).toEqual([
      'update p1',
      'publish p1',
      'update p2',
      'publish p2',
      'update p1',
      'publish p1',
    ]);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published').related).toEqual(['p2']);
  });
  it('the fix of a published document with newer draft changes keeps both versions apart', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'published', page({ title: 'Live', related: [{ documentId: 'p1', locale: 'en' }] }));
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ title: 'Next', related: [{ documentId: 'p1', locale: 'en' }] }));
    await t.run({ status: 'follow' });
    expect(t.docs.writes().map((c) => c.action)).toEqual(['update', 'publish', 'update', 'update', 'publish', 'update']);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published')).toMatchObject({ title: '[pt] Live', related: ['p1'] });
    expect(t.docs.get(PAGE, 'p1', 'pt', 'draft')).toMatchObject({ title: '[pt] Next', related: ['p1'] });
    // Translated once per version, reused by the fix.
    expect(t.ai.translateStrings).toHaveBeenCalledTimes(2);
  });
});

describe('DuplicateService — existing content and status', () => {
  it('Skip leaves an existing target untouched and still counts it as available', async () => {
    t.docs.seed(AUTHOR, 'a1', 'en', 'draft', { name: 'Ann' });
    t.docs.seed(AUTHOR, 'a1', 'pt', 'draft', { name: 'Ana' });
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ author: { documentId: 'a1', locale: 'en' } }));
    const run = await t.run({ existing: 'skip', status: 'draft' });
    expect(t.updates(AUTHOR)).toEqual([]);
    expect(t.updates(PAGE)[0].data.author).toBe('a1');
    expect(t.docs.get(AUTHOR, 'a1', 'pt')).toEqual({ name: 'Ana' });
    expect(run.counts).toMatchObject({ duplicated: 1, skipped: 1 });
  });

  it('Replace makes a true copy: empty source fields are emptied', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ link: '' }));
    t.docs.seed(PAGE, 'p1', 'pt', 'draft', { title: 'Antigo', link: '/antigo', related: ['p9'] });
    const run = await t.run({ existing: 'replace', status: 'draft' });
    const [w] = t.updates();
    expect(w.data.link).toBeNull();
    expect(w.data.related).toEqual([]);
    expect(w.data.seo).toBeNull();
    expect(w.data.ctas).toEqual([]);
    expect(run.counts).toMatchObject({ replaced: 1, duplicated: 0 });
  });

  it('"Keep everything as a draft" never publishes', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p1', 'en', 'published', page());
    await t.run({ status: 'draft' });
    expect(t.docs.writes('publish')).toEqual([]);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published')).toBeUndefined();
  });

  it('follow: a draft-only source stays a draft', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    await t.run({ status: 'follow' });
    expect(t.docs.writes('publish')).toEqual([]);
    expect(t.docs.get(PAGE, 'p1', 'pt')).toBeDefined();
  });

  it('follow: published with no newer draft is written once and published', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p1', 'en', 'published', page());
    await t.run({ status: 'follow' });
    expect(t.docs.writes().map((c) => c.action)).toEqual(['update', 'publish']);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published').title).toBe('[pt] About');
    expect(t.ai.translateStrings).toHaveBeenCalledTimes(1);
  });

  it('follow: published with newer draft changes gets both versions', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'published', page({ title: 'Live' }));
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ title: 'Work in progress' }));
    await t.run({ status: 'follow' });
    expect(t.docs.writes().map((c) => c.action)).toEqual(['update', 'publish', 'update']);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published').title).toBe('[pt] Live');
    expect(t.docs.get(PAGE, 'p1', 'pt', 'draft').title).toBe('[pt] Work in progress');
  });

  it('Replace + draft leaves the target published version untouched', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p1', 'en', 'published', page());
    t.docs.seed(PAGE, 'p1', 'pt', 'draft', { title: 'Antigo' });
    t.docs.seed(PAGE, 'p1', 'pt', 'published', { title: 'Publicado' });
    await t.run({ existing: 'replace', status: 'draft' });
    expect(t.docs.writes().map((c) => c.action)).toEqual(['update']);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published')).toEqual({ title: 'Publicado' });
    expect(t.docs.get(PAGE, 'p1', 'pt', 'draft').title).toBe('[pt] About');
  });

  it('Replace + follow unpublishes a target whose source was never published', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p1', 'pt', 'draft', { title: 'Antigo' });
    t.docs.seed(PAGE, 'p1', 'pt', 'published', { title: 'Publicado' });
    await t.run({ existing: 'replace', status: 'follow' });
    expect(t.docs.writes().map((c) => c.action)).toEqual(['update', 'unpublish']);
    expect(t.docs.get(PAGE, 'p1', 'pt', 'published')).toBeUndefined();
  });
});

describe('DuplicateService — slug and page attributes', () => {
  const attr = (contentId: string, state: string, over: any = {}) => ({
    state,
    contentId,
    contentModel: PAGE,
    locale: 'en',
    parentContentId: null,
    parentContentModel: null,
    templateId: null,
    priority: null,
    frequency: null,
    ...over,
  });

  it('sends the translated slug and the parent mapped to its target-locale document, for draft and published', async () => {
    for (const status of ['draft', 'published'] as const) {
      t.docs.seed(PAGE, 'p1', 'en', status, page({ title: 'Parent', slug: 'parent' }));
      t.docs.seed(PAGE, 'p2', 'en', status, page({ title: 'Child', slug: 'child-page' }));
      t.db.tables[ATTR].push(
        attr('p2', status, { parentContentId: 'p1', parentContentModel: PAGE, templateId: 'tpl1', priority: '0.5', frequency: 'weekly' })
      );
    }
    // A page of another locale with the same parent must not be read.
    t.db.tables[ATTR].push(attr('p1', 'draft', { locale: 'fr', parentContentId: 'zz', parentContentModel: PAGE }));
    await t.run({ status: 'follow' });
    expect(t.docs.writes().map((c) => `${c.action} ${c.params.documentId}`)).toEqual([
      'update p1',
      'publish p1',
      'update p2',
      'publish p2',
    ]);
    const child = t.updates()[1].data;
    expect(child).toMatchObject({
      ltb_slug: 'pt-child-page',
      ltb_attribute_parent: 'p1',
      ltb_attribute_parent_model: PAGE,
      ltb_attribute_template: 'tpl1',
      ltb_attribute_priority: '0.5',
      ltb_attribute_frequency: 'weekly',
    });
    expect(t.updates()[0].data).toMatchObject({ ltb_slug: 'pt-parent' });
    // No page attributes on the source nor on the target: none are sent (no empty row is created).
    expect(t.updates()[0].data).not.toHaveProperty('ltb_attribute_parent');
  });

  it('reads the parent from the slug row when there is no attribute row', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ slug: 'parent' }));
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ slug: 'child' }));
    t.db.tables[SLUG].push({ state: 'draft', slug: 'child', contentId: 'p2', contentModel: PAGE, locale: 'en', parentContentId: 'p1', parentContentModel: PAGE });
    await t.run({ status: 'draft' });
    expect(t.updates().map((u) => [u.id, u.data.ltb_attribute_parent])).toEqual([
      ['p1', undefined],
      ['p2', 'p1'],
    ]);
  });

  it('a parent in a cycle is sent empty first and set by the fix', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ slug: 'one' }));
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ slug: 'two', related: [{ documentId: 'p1', locale: 'en' }] }));
    t.db.tables[ATTR].push(attr('p1', 'draft', { parentContentId: 'p2', parentContentModel: PAGE }));
    const run = await t.run({ status: 'draft' });
    expect(run.failures).toEqual([]);
    const [first, second, fix] = t.updates();
    expect([first.id, first.data.ltb_attribute_parent]).toEqual(['p1', null]);
    expect([second.id, second.data.related]).toEqual(['p2', ['p1']]);
    expect(fix).toEqual({ id: 'p1', data: { ltb_attribute_parent: 'p2', ltb_attribute_parent_model: PAGE } });
  });

  it('Replace with an empty source slug clears an existing target slug row, and never creates one', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ slug: '' }));
    t.docs.seed(PAGE, 'p1', 'pt', 'draft', { title: 'Antigo' });
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ slug: '' }));
    t.docs.seed(PAGE, 'p2', 'pt', 'draft', { title: 'Outro' });
    t.db.tables[SLUG].push({ state: 'draft', slug: 'antigo', contentId: 'p2', contentModel: PAGE, locale: 'pt', parentContentId: null, parentContentModel: null });
    await t.run({ existing: 'replace', status: 'draft' });
    const [p1, p2] = [t.updates().find((u) => u.id === 'p1')!, t.updates().find((u) => u.id === 'p2')!];
    expect(p1.data).not.toHaveProperty('ltb_slug');
    expect(p1.data).not.toHaveProperty('ltb_attribute_template');
    expect(p2.data.ltb_slug).toBeNull();
  });

  it('Replace sends empty page attributes only to clear the target attribute row', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p1', 'pt', 'draft', { title: 'Antigo' });
    t.db.tables[ATTR].push({ ...attr('p1', 'draft', { templateId: 'old' }), locale: 'pt' });
    await t.run({ existing: 'replace', status: 'draft' });
    expect(t.updates()[0].data).toMatchObject({ ltb_attribute_template: null, ltb_attribute_parent: null });
  });

  it('a parent that is not part of the run is left empty and reported', async () => {
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ slug: 'child' }));
    t.db.tables[ATTR].push(attr('p2', 'draft', { parentContentId: 'gone', parentContentModel: PAGE }));
    const run = await t.run({ status: 'draft' });
    expect(t.updates()[0].data.ltb_attribute_parent).toBeNull();
    expect(run.failures).toEqual([
      expect.objectContaining({ uid: PAGE, documentId: 'p2', reason: expect.stringContaining('Relation "parent" left empty'), kind: 'note' }),
    ]);
    expect(run.counts).toMatchObject({ duplicated: 1, failed: 0 });
  });
});

describe('DuplicateService — AI', () => {
  it('without AI the content is copied untranslated and counted', async () => {
    t.ai.getCredentials.mockResolvedValue(null);
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    const run = await t.run({ status: 'draft' });
    expect(t.ai.translateStrings).not.toHaveBeenCalled();
    expect(t.updates()[0].data).toMatchObject({ title: 'About', ltb_slug: 'about-us' });
    expect(run.counts).toMatchObject({ duplicated: 1, untranslated: 1 });
  });

  it('a partial AI failure keeps the source text and counts the document untranslated', async () => {
    t.ai.translateStrings.mockResolvedValue({ translations: { '0': 'Sobre' }, failed: 1, errors: ['pt: x'] } as any);
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    const run = await t.run({ status: 'draft' });
    expect(t.updates()[0].data).toMatchObject({ title: 'Sobre', ltb_slug: 'about-us' });
    expect(run.counts.untranslated).toBe(1);
  });

  it('sends the AI the most characters each translated field accepts', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    await t.run({ status: 'draft' });
    const [, , , strings, maxLengths] = t.ai.translateStrings.mock.calls[0] as any[];
    const titleKey = Object.keys(strings).find((k) => strings[k] === 'About');
    expect(titleKey).toBeDefined();
    expect(maxLengths).toEqual({ [titleKey as string]: 255 });
  });

  it('records the AI errors on the run, readable and without the API key', async () => {
    t.ai.translateStrings.mockResolvedValue({
      translations: {},
      failed: 2,
      errors: [
        'pt: OpenAI request failed with status 429: {"error": {"message": "You have no credits remaining."}}',
        'pt: Invalid key sk-abc123XYZ',
      ],
    } as any);
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ title: 'Team' }));
    const run = await t.run({ status: 'draft' });
    expect(run.aiErrors).toEqual(['You have no credits remaining.', 'Invalid key sk-…']);
  });

  it('an AI call that throws copies the source text', async () => {
    t.ai.translateStrings.mockRejectedValue(new Error('timeout'));
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    const run = await t.run({ status: 'draft' });
    expect(run.status).toBe('SUCCESS');
    expect(t.updates()[0].data.title).toBe('About');
    expect(run.counts.untranslated).toBe(1);
  });
});

describe('DuplicateService — failures and scope', () => {
  it('one failing document is recorded, its dependents lose the relation, the run continues', async () => {
    t.docs.seed(AUTHOR, 'a1', 'en', 'draft', { name: 'Ann' });
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page({ author: { documentId: 'a1', locale: 'en' } }));
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page({ title: 'Two' }));
    t.docs.failOn(AUTHOR, 'a1');
    const run = await t.run({ status: 'draft' });
    expect(run.status).toBe('SUCCESS');
    expect(run.counts).toMatchObject({ duplicated: 2, failed: 1 });
    expect(t.updates(PAGE).find((u) => u.id === 'p1')!.data).not.toHaveProperty('author');
    expect(t.docs.get(PAGE, 'p1', 'pt').author).toBeUndefined();
    expect(run.failures).toEqual([
      { uid: AUTHOR, documentId: 'a1', title: 'Ann', reason: 'Write refused' },
      {
        uid: PAGE,
        documentId: 'p1',
        title: 'About',
        reason: `Relation "author" left empty: ${AUTHOR} a1 could not be duplicated`,
        kind: 'note',
      },
    ]);
  });

  it('reads every document of a type over several pages, in a stable order', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `t${String(i).padStart(3, '0')}`);
    for (const id of ids) {
      for (const status of ['draft', 'published'] as const) t.docs.seed(PAGE, id, 'en', status, page({ title: id, slug: id }));
    }
    const run = await t.run({ status: 'follow' });
    expect(run.counts).toMatchObject({ duplicated: 101, failed: 0 });
    expect(new Set(t.updates(PAGE).map((u) => u.id))).toEqual(new Set(ids));
    // Every published source is matched with its draft, so every target is published.
    expect(t.docs.writes('publish')).toHaveLength(101);
  });

  it('ignores non-api and not localized types and a single type without a default-locale entry', async () => {
    t.docs.seed('api::plain.plain', 'x1', 'en', 'draft', { name: 'Plain' });
    t.docs.seed(SLUG, 's1', 'en', 'draft', {});
    t.docs.seed(HOME, 'h1', 'pt', 'draft', { headline: 'Só PT' });
    const run = await t.run();
    expect(run.status).toBe('SUCCESS');
    expect(t.docs.writes()).toEqual([]);
    expect(run.progress.total).toBe(0);
    expect(run.failures).toEqual([]);
  });

  it('duplicates a single type entry of the default locale', async () => {
    t.docs.seed(HOME, 'h1', 'en', 'draft', { headline: 'Welcome' });
    await t.run({ status: 'draft' });
    expect(t.updates()).toEqual([{ id: 'h1', data: { headline: '[pt] Welcome' } }]);
  });
});

describe('DuplicateService — start', () => {
  it('answers before the run ends and the run finishes in the background', async () => {
    let release!: () => void;
    t.ai.getCredentials.mockReturnValue(new Promise((resolve) => (release = () => resolve(null))));
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    const { runId } = await t.svc.start({ targetLocale: 'pt', existing: 'skip', status: 'draft' }, { id: 1, name: 'A' });
    expect((await t.runs.running())?.id).toBe(runId);
    await expect(
      t.svc.start({ targetLocale: 'pt', existing: 'skip', status: 'draft' }, { id: 1, name: 'A' })
    ).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
    release();
    await t.svc.whenIdle();
    expect(await t.runs.running()).toBeNull();
    expect((await t.runs.list())[0]).toMatchObject({ id: runId, status: 'SUCCESS' });
  });

  it('refuses while a run is RUNNING in the log', async () => {
    await t.runs.start({ sourceLocale: 'en', targetLocale: 'fr', options: {}, userId: null, userName: null, total: 0 });
    await expect(
      t.svc.start({ targetLocale: 'pt', existing: 'skip', status: 'draft' }, { id: 1, name: 'A' })
    ).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
  });

  it.each([
    [{ targetLocale: 'en' }, 'invalid_locale'],
    [{ targetLocale: 'de' }, 'invalid_locale'],
    [{ targetLocale: 'pt', existing: 'merge' }, 'invalid_option'],
    [{ targetLocale: 'pt', status: 'published' }, 'invalid_option'],
    [{ targetLocale: 'pt', ecommerce: 'yes' }, 'invalid_option'],
  ])('refuses %o with %s', async (input, code) => {
    await expect(t.svc.start({ existing: 'skip', status: 'draft', ...input }, { id: 1, name: 'A' })).rejects.toMatchObject({ code });
    expect(await t.runs.list()).toEqual([]);
  });

  it('a crash of the run itself marks it FAILED', async () => {
    t.strapi.documents = () => {
      throw new TypeError('boom');
    };
    t.strapi.contentTypes = new Proxy(contentTypes, {
      ownKeys: () => {
        throw new RangeError('broken schema');
      },
    });
    const run = await t.run();
    expect(run.status).toBe('FAILED');
    expect(run.failures).toEqual([{ uid: 'run', documentId: '', reason: 'broken schema' }]);
  });
});

describe('DuplicateService — summary', () => {
  it('counts default-locale documents per content type and says whether AI is available', async () => {
    t.docs.seed(PAGE, 'p1', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p2', 'en', 'draft', page());
    t.docs.seed(PAGE, 'p3', 'pt', 'draft', page());
    t.docs.seed(AUTHOR, 'a1', 'en', 'draft', { name: 'Ann' });
    expect(await t.svc.summary('pt', false)).toEqual({
      sourceLocale: 'en',
      targetLocale: 'pt',
      aiAvailable: true,
      contentTypes: [
        { uid: AUTHOR, displayName: AUTHOR, count: 1 },
        { uid: PAGE, displayName: PAGE, count: 2 },
      ],
    });
  });

  it('adds the e-commerce counts only when asked and the module is on', async () => {
    t.ai.getCredentials.mockResolvedValue(null);
    t.db.tables[EU.productTranslation].push({ id: 1, product: 1, locale: 'en', name: 'Shirt' }, { id: 2, product: 1, locale: 'pt', name: 'Camisa' });
    t.db.tables[EU.tagTranslation].push({ id: 1, tag: 1, locale: 'en', name: 'Sale' });
    t.email.list.mockResolvedValue([
      { type: 'ORDER_CONFIRMATION', customLocales: ['en', 'pt'] },
      { type: 'ORDER_SHIPPED', customLocales: ['pt'] },
    ]);
    expect((await t.svc.summary('pt', true)).ecommerce).toBeUndefined();
    t.db.tables[SETTING].push({ id: 1, module: 'ecommerce', property: 'active', value: 'true' });
    const summary = await t.svc.summary('pt', true);
    expect(summary.aiAvailable).toBe(false);
    expect(summary.ecommerce).toEqual({ products: 1, variants: 0, categories: 0, collections: 0, tags: 1, emailTemplates: 1 });
    expect((await t.svc.summary('pt', false)).ecommerce).toBeUndefined();
  });

  it('refuses an invalid target locale', async () => {
    await expect(t.svc.summary('en', false)).rejects.toMatchObject({ code: 'invalid_locale' });
  });
});

describe('DuplicateService — e-commerce', () => {
  beforeEach(() => {
    t.db.tables[SETTING].push({ id: 1, module: 'ecommerce', property: 'active', value: 'true' });
    t.db.tables[EU.product].push({ id: 1 }, { id: 2 });
    t.db.tables[EU.productTranslation].push(
      { id: 1, product: 1, locale: 'en', name: 'Shirt', slug: 'shirt', shortDescription: '', description: '<p>Cotton</p>' },
      // Another product already holds the slug the translation gives.
      { id: 2, product: 2, locale: 'pt', name: 'Camisa', slug: 'pt-shirt' }
    );
    t.db.tables[EU.category].push({ id: 1 });
    t.db.tables[EU.categoryTranslation].push({ id: 1, category: 1, locale: 'en', name: 'Tops', slug: 'tops', description: null, seoTitle: 'Tops', seoDescription: null });
  });

  it('creates translated rows with unique slugs, and the customized e-mail templates', async () => {
    t.email.list.mockResolvedValue([{ type: 'ORDER_CONFIRMATION', customLocales: ['en'] }]);
    t.email.get.mockResolvedValue({ subject: 'Thanks {{order.number}}', html: '<p>Hello there</p>' });
    const run = await t.run({ ecommerce: true });
    expect(run.options.ecommerce).toBe(true);
    const created = t.db.tables[EU.productTranslation].find((r) => r.product === 1 && r.locale === 'pt');
    expect(created).toMatchObject({ name: '[pt] Shirt', slug: 'pt-shirt-2', description: '[pt] <p>Cotton</p>', shortDescription: '' });
    expect(t.db.tables[EU.categoryTranslation].find((r) => r.locale === 'pt')).toMatchObject({
      category: 1,
      name: '[pt] Tops',
      slug: 'pt-tops',
      seoTitle: '[pt] Tops',
      description: null,
    });
    expect(t.email.save).toHaveBeenCalledWith(
      'ORDER_CONFIRMATION',
      'pt',
      { subject: '[pt] Thanks {{order.number}}', html: '<p>[pt] Hello there</p>' },
      '7'
    );
    expect(run.counts).toMatchObject({ duplicated: 3, failed: 0 });
    expect(run.progress.total).toBe(3);
  });

  it('Skip leaves an existing translation row; Replace updates it and keeps its slug', async () => {
    t.db.tables[EU.categoryTranslation].push({ id: 2, category: 1, locale: 'pt', name: 'Topos', slug: 'topos' });
    let run = await t.run({ ecommerce: true, existing: 'skip' });
    expect(t.db.tables[EU.categoryTranslation].find((r) => r.id === 2)).toMatchObject({ name: 'Topos' });
    expect(run.counts.skipped).toBe(1);
    run = await t.run({ ecommerce: true, existing: 'replace' });
    expect(t.db.tables[EU.categoryTranslation].find((r) => r.id === 2)).toMatchObject({ name: '[pt] Tops', slug: 'topos' });
    expect(run.counts.replaced).toBe(2);
  });

  it('is not run while the module is off', async () => {
    t.db.tables[SETTING][0].value = 'false';
    const run = await t.run({ ecommerce: true });
    expect(run.options.ecommerce).toBe(false);
    expect(t.db.tables[EU.productTranslation]).toHaveLength(2);
  });

  it('an e-mail template that is not translated is not saved: the built-in template of the target is kept', async () => {
    t.ai.getCredentials.mockResolvedValue(null);
    t.email.list.mockResolvedValue([{ type: 'PASSWORD_RESET', customLocales: ['en'] }]);
    t.email.get.mockResolvedValue({ subject: 'Reset', html: '<p>Click here</p>' });
    const run = await t.run({ ecommerce: true });
    expect(t.email.save).not.toHaveBeenCalled();
    expect(run.counts.skipped).toBe(1);
    expect(run.failures).toContainEqual({
      uid: EU.emailTemplate,
      documentId: 'PASSWORD_RESET',
      title: 'PASSWORD_RESET',
      reason: 'Not translated (AI unavailable or the translation failed): the built-in pt template is kept',
    });
  });

  it('a partly translated e-mail template is not saved either', async () => {
    t.ai.translateStrings.mockImplementation(async (_c: any, _s: any, _t: any, strings: Record<string, string>) => {
      const [first] = Object.keys(strings);
      return { translations: { [first]: 'Só um' }, failed: 1, errors: [] };
    });
    t.email.list.mockResolvedValue([{ type: 'PASSWORD_RESET', customLocales: ['en', 'pt'] }]);
    t.email.get.mockResolvedValue({ subject: 'Reset', html: '<p>Click here</p>' });
    const run = await t.run({ ecommerce: true, existing: 'replace' });
    expect(t.email.save).not.toHaveBeenCalled();
    expect(run.failures).toContainEqual(
      expect.objectContaining({ documentId: 'PASSWORD_RESET', reason: expect.stringContaining('the current pt template is kept') })
    );
  });

  it('a translation row saved while the run is going is replaced or skipped, never created twice', async () => {
    // The row appears after the e-commerce items were listed (during the content part).
    t.docs.seed(AUTHOR, 'a1', 'en', 'draft', { name: 'Ann' });
    t.ai.translateStrings.mockImplementationOnce(async (_c: any, _s: any, _t: any, strings: Record<string, string>) => {
      t.db.tables[EU.categoryTranslation].push({ id: 9, category: 1, locale: 'pt', name: 'Novo', slug: 'novo' });
      return { translations: strings, failed: 0, errors: [] };
    });
    let run = await t.run({ ecommerce: true, existing: 'skip' });
    expect(t.db.tables[EU.categoryTranslation].filter((r) => r.category === 1 && r.locale === 'pt')).toHaveLength(1);
    expect(run.counts.skipped).toBe(1);
    t.db.tables[EU.categoryTranslation] = t.db.tables[EU.categoryTranslation].filter((r) => r.id !== 9);
    t.ai.translateStrings.mockImplementationOnce(async (_c: any, _s: any, _t: any, strings: Record<string, string>) => {
      t.db.tables[EU.categoryTranslation].push({ id: 10, category: 1, locale: 'pt', name: 'Novo', slug: 'novo' });
      return { translations: strings, failed: 0, errors: [] };
    });
    run = await t.run({ ecommerce: true, existing: 'replace' });
    const rows = t.db.tables[EU.categoryTranslation].filter((r) => r.category === 1 && r.locale === 'pt');
    expect(rows).toEqual([expect.objectContaining({ id: 10, name: '[pt] Tops', slug: 'novo' })]);
  });

  it('a new slug avoids the slugs of translation rows without an owner', async () => {
    t.db.tables[EU.categoryTranslation].push({ id: 5, category: null, locale: 'pt', name: 'Orphan', slug: 'pt-tops' });
    await t.run({ ecommerce: true });
    const created = t.db.tables[EU.categoryTranslation].find((r) => r.category === 1 && r.locale === 'pt');
    expect(created).toMatchObject({ slug: 'pt-tops-2' });
  });

  it('a failing e-mail template is reported and the run continues', async () => {
    t.email.list.mockResolvedValue([{ type: 'ORDER_CONFIRMATION', customLocales: ['en'] }]);
    t.email.get.mockResolvedValue({ subject: 'Hi', html: '<p>Hi</p>' });
    t.email.save.mockRejectedValue(new Error('Invalid template'));
    const run = await t.run({ ecommerce: true });
    expect(run.status).toBe('SUCCESS');
    expect(run.failures).toEqual([
      { uid: EU.emailTemplate, documentId: 'ORDER_CONFIRMATION', title: 'ORDER_CONFIRMATION', reason: 'Invalid template' },
    ]);
    expect(run.counts).toMatchObject({ duplicated: 2, failed: 1 });
  });
});
