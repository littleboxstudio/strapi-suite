import { describe, it, expect } from 'vitest';
import {
  DUPLICATE_RUN_ACTION,
  contentTypeLabel,
  currentLabel,
  defaultOptions,
  documentLabel,
  ecommerceRows,
  errorMessageKey,
  failureRows,
  isRunning,
  latestRun,
  localeName,
  namesFromSummary,
  progressPercent,
  reportCounts,
  startInput,
  summaryTotals,
  targetLocales,
  validateOptions,
} from '../../../admin/src/duplicate/utils';
import { rbacKey } from '../../../admin/src/ecommerce/utils/rbac';
import type { DuplicateLocales, DuplicateRun, DuplicateSummary } from '../../../admin/src/duplicate/gateway';

const LOCALES: DuplicateLocales = {
  defaultLocale: 'en',
  locales: [
    { code: 'en', name: 'English (en)' },
    { code: 'pt', name: 'Portuguese (pt)' },
    { code: 'fr', name: 'French (fr)' },
  ],
};

const run = (patch: Partial<DuplicateRun> = {}): DuplicateRun => ({
  id: 1,
  status: 'SUCCESS',
  sourceLocale: 'en',
  targetLocale: 'pt',
  options: { existing: 'skip', status: 'follow', ecommerce: false },
  startedAt: '2026-11-27T10:00:00.000Z',
  finishedAt: '2026-11-27T10:05:00.000Z',
  userId: '1',
  userName: 'Ana',
  progress: { total: 10, done: 10, current: null },
  counts: { duplicated: 8, replaced: 0, skipped: 1, untranslated: 2, failed: 1 },
  failures: [],
  ...patch,
});

describe('permission', () => {
  it('is the duplicate.run action, read by useRBAC as canRun', () => {
    expect(DUPLICATE_RUN_ACTION).toBe('plugin::littlebox-strapi-suite.duplicate.run');
    expect(rbacKey(DUPLICATE_RUN_ACTION)).toBe('canRun');
  });
});

describe('locales', () => {
  it('offers every locale but the default as a target', () => {
    expect(targetLocales(LOCALES).map((l) => l.code)).toEqual(['pt', 'fr']);
    expect(targetLocales(null)).toEqual([]);
  });

  it('names a locale, falling back to its code', () => {
    expect(localeName(LOCALES.locales, 'pt')).toBe('Portuguese (pt)');
    expect(localeName(LOCALES.locales, 'de')).toBe('de');
    expect(localeName(undefined, 'de')).toBe('de');
  });
});

describe('options', () => {
  it('defaults to the first other locale, Skip, Follow the original, no e-commerce', () => {
    expect(defaultOptions(LOCALES)).toEqual({
      targetLocale: 'pt',
      existing: 'skip',
      status: 'follow',
      ecommerce: false,
    });
  });

  it('has no target when only the default locale exists', () => {
    expect(defaultOptions({ defaultLocale: 'en', locales: [{ code: 'en', name: 'English' }] }).targetLocale).toBe('');
    expect(defaultOptions(null).targetLocale).toBe('');
  });

  it('accepts valid options', () => {
    expect(validateOptions(defaultOptions(LOCALES), LOCALES)).toBeNull();
    expect(validateOptions({ targetLocale: 'fr', existing: 'replace', status: 'draft', ecommerce: true }, LOCALES)).toBeNull();
  });

  it('refuses an empty, unknown or default target', () => {
    const base = defaultOptions(LOCALES);
    expect(validateOptions({ ...base, targetLocale: '' }, LOCALES)).toBe('duplicate.errors.chooseTarget');
    expect(validateOptions({ ...base, targetLocale: 'de' }, LOCALES)).toBe('duplicate.errors.chooseTarget');
    expect(validateOptions({ ...base, targetLocale: 'en' }, LOCALES)).toBe('duplicate.errors.chooseTarget');
  });

  it('refuses unknown existing / status choices', () => {
    const base = defaultOptions(LOCALES);
    expect(validateOptions({ ...base, existing: 'merge' as any }, LOCALES)).toBe('duplicate.errors.invalidOption');
    expect(validateOptions({ ...base, status: 'published' as any }, LOCALES)).toBe('duplicate.errors.invalidOption');
  });

  it('sends e-commerce only while the module is on', () => {
    const options = { ...defaultOptions(LOCALES), ecommerce: true };
    expect(startInput(options, true).ecommerce).toBe(true);
    expect(startInput(options, false).ecommerce).toBe(false);
    expect(startInput({ ...options, ecommerce: false }, true).ecommerce).toBe(false);
  });
});

describe('progressPercent', () => {
  it('is 0 while the total is unknown', () => {
    expect(progressPercent({ total: 0, done: 0 })).toBe(0);
    expect(progressPercent(null)).toBe(0);
    expect(progressPercent(undefined)).toBe(0);
  });

  it('rounds to a whole percentage and stays within 0–100', () => {
    expect(progressPercent({ total: 3, done: 1 })).toBe(33);
    expect(progressPercent({ total: 3, done: 2 })).toBe(67);
    expect(progressPercent({ total: 4, done: 4 })).toBe(100);
    expect(progressPercent({ total: 4, done: 9 })).toBe(100);
    expect(progressPercent({ total: 4, done: -1 })).toBe(0);
  });
});

describe('summary', () => {
  const summary: DuplicateSummary = {
    sourceLocale: 'en',
    targetLocale: 'pt',
    aiAvailable: true,
    contentTypes: [
      { uid: 'api::article.article', displayName: 'Article', count: 4 },
      { uid: 'api::page.page', displayName: 'Page', count: 3 },
    ],
    ecommerce: { products: 2, variants: 5, categories: 1, collections: 0, tags: 3, emailTemplates: 1 },
  };

  it('adds up the contents and the e-commerce items', () => {
    expect(summaryTotals(summary)).toEqual({ contents: 7, ecommerce: 12 });
    expect(summaryTotals({ ...summary, ecommerce: undefined })).toEqual({ contents: 7, ecommerce: 0 });
  });

  it('lists the e-commerce counts in a fixed order', () => {
    expect(ecommerceRows(summary.ecommerce)).toEqual([
      { key: 'products', labelKey: 'duplicate.summary.ecommerce.products', count: 2 },
      { key: 'variants', labelKey: 'duplicate.summary.ecommerce.variants', count: 5 },
      { key: 'categories', labelKey: 'duplicate.summary.ecommerce.categories', count: 1 },
      { key: 'collections', labelKey: 'duplicate.summary.ecommerce.collections', count: 0 },
      { key: 'tags', labelKey: 'duplicate.summary.ecommerce.tags', count: 3 },
      { key: 'emailTemplates', labelKey: 'duplicate.summary.ecommerce.emailTemplates', count: 1 },
    ]);
    expect(ecommerceRows(undefined)).toEqual([]);
  });

  it('keys the display names by uid', () => {
    expect(namesFromSummary(summary)).toEqual({ 'api::article.article': 'Article', 'api::page.page': 'Page' });
    expect(namesFromSummary(null)).toEqual({});
  });
});

describe('report', () => {
  it('lists the counts in a fixed order, missing ones as 0', () => {
    expect(reportCounts(run().counts).map((r) => [r.key, r.value])).toEqual([
      ['duplicated', 8],
      ['replaced', 0],
      ['skipped', 1],
      ['untranslated', 2],
      ['failed', 1],
    ]);
    expect(reportCounts({ duplicated: 3 }).map((r) => r.value)).toEqual([3, 0, 0, 0, 0]);
    expect(reportCounts(undefined)[0].labelKey).toBe('duplicate.report.counts.duplicated');
  });

  it('turns the failures into table rows', () => {
    const rows = failureRows(
      [
        { uid: 'api::article.article', documentId: 'abc', title: 'Hello', reason: 'Boom' },
        { uid: 'api::page.page', documentId: 'def', reason: 'Bad' },
        { uid: 'run', documentId: '', reason: 'Crashed' },
        { uid: 'api::page.page', documentId: 'ghi', reason: 'Relation "x" left empty', kind: 'note' },
      ],
      { 'api::article.article': 'Article' }
    );
    expect(rows.map(({ contentType, document, reason, note }) => [contentType, document, reason, note])).toEqual([
      ['Article', 'Hello', 'Boom', false],
      ['page', 'def', 'Bad', false],
      ['', '', 'Crashed', false],
      ['page', 'ghi', 'Relation "x" left empty', true],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(4);
    expect(failureRows(undefined)).toEqual([]);
  });
});

describe('labels', () => {
  it('names a content type from the summary, else from its uid', () => {
    expect(contentTypeLabel('api::article.article', { 'api::article.article': 'Article' })).toBe('Article');
    expect(contentTypeLabel('api::article.article')).toBe('article');
    expect(contentTypeLabel('api::blog.post')).toBe('blog.post');
    expect(
      contentTypeLabel('plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-product-translation')
    ).toBe('product-translation');
    expect(contentTypeLabel('plugin::littlebox-strapi-suite.other')).toBe('other');
    expect(contentTypeLabel('weird')).toBe('weird');
    expect(contentTypeLabel('run')).toBe('');
  });

  it('names a document by its title, else its id', () => {
    expect(documentLabel({ documentId: 'abc', title: 'Hello' })).toBe('Hello');
    expect(documentLabel({ documentId: 'abc', title: '  ' })).toBe('abc');
    expect(documentLabel({ documentId: 'abc' })).toBe('abc');
  });

  it('describes the current document', () => {
    expect(currentLabel({ uid: 'api::page.page', documentId: 'x', title: 'Home' })).toBe('page · Home');
    expect(currentLabel(null)).toBe('');
  });
});

describe('runs', () => {
  it('takes the newest run (the list comes newest first)', () => {
    expect(latestRun([run({ id: 3 }), run({ id: 2 })])?.id).toBe(3);
    expect(latestRun([])).toBeNull();
    expect(latestRun(null)).toBeNull();
  });

  it('knows a running run', () => {
    expect(isRunning(run({ status: 'RUNNING' }))).toBe(true);
    expect(isRunning(run())).toBe(false);
    expect(isRunning(null)).toBe(false);
  });
});

describe('errorMessageKey', () => {
  it('reads the server code when the body is kept', () => {
    expect(errorMessageKey({ response: { data: { code: 'RUN_IN_PROGRESS' } } })).toBe('duplicate.errors.runInProgress');
    expect(errorMessageKey({ response: { data: { code: 'invalid_locale' } } })).toBe('duplicate.errors.invalidLocale');
    expect(errorMessageKey({ response: { data: { error: { details: { code: 'invalid_option' } } } } })).toBe(
      'duplicate.errors.invalidOption'
    );
  });

  it('falls back on the HTTP status', () => {
    expect(errorMessageKey({ status: 409 })).toBe('duplicate.errors.runInProgress');
    expect(errorMessageKey({ status: 400 })).toBe('duplicate.errors.invalidRequest');
    expect(errorMessageKey({ status: 403 })).toBe('duplicate.errors.forbidden');
    expect(errorMessageKey({ response: { data: { error: { status: 400 } } } })).toBe('duplicate.errors.invalidRequest');
  });

  it('is generic otherwise', () => {
    expect(errorMessageKey(new Error('network'))).toBe('duplicate.errors.generic');
    expect(errorMessageKey(undefined)).toBe('duplicate.errors.generic');
    expect(errorMessageKey({ status: 500 })).toBe('duplicate.errors.generic');
  });
});
