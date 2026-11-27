import type {
  DuplicateCounts,
  DuplicateCurrent,
  DuplicateEcommerceCounts,
  DuplicateFailure,
  DuplicateLocales,
  DuplicateRun,
  DuplicateRunStatus,
  DuplicateStartInput,
  DuplicateSummary,
} from './gateway';

/** The permission that shows the card and opens every duplicate route. */
export const DUPLICATE_RUN_ACTION = 'plugin::littlebox-strapi-suite.duplicate.run';

/** How often the modal asks for the running run's progress. */
export const POLL_INTERVAL_MS = 2000;

/** The badge colour of each run status (the e-commerce ToneBadge variants). */
export const RUN_STATUS_VARIANT: Record<DuplicateRunStatus, 'primary' | 'success' | 'danger' | 'neutral'> = {
  RUNNING: 'primary',
  SUCCESS: 'success',
  FAILED: 'danger',
  INTERRUPTED: 'neutral',
};

type Locale = { code: string; name: string };

/** The locales a run can write to: every configured locale but the default one. */
export function targetLocales(data: DuplicateLocales | null): Locale[] {
  if (!data) return [];
  return data.locales.filter((l) => l.code !== data.defaultLocale);
}

/** The locale's name, or its code when it is not (or no longer) configured. */
export function localeName(locales: Locale[] | undefined, code: string): string {
  return locales?.find((l) => l.code === code)?.name || code;
}

/** The modal's starting choices: the first other locale, Skip, Follow the original, no e-commerce. */
export function defaultOptions(data: DuplicateLocales | null): DuplicateStartInput {
  return {
    targetLocale: targetLocales(data)[0]?.code ?? '',
    existing: 'skip',
    status: 'follow',
    ecommerce: false,
  };
}

/**
 * Null when the options can be sent, otherwise the translation key of the problem. The target must
 * be a configured locale other than the default.
 */
export function validateOptions(options: DuplicateStartInput, data: DuplicateLocales | null): string | null {
  if (!targetLocales(data).some((l) => l.code === options.targetLocale)) {
    return 'duplicate.errors.chooseTarget';
  }
  if (options.existing !== 'skip' && options.existing !== 'replace') return 'duplicate.errors.invalidOption';
  if (options.status !== 'follow' && options.status !== 'draft') return 'duplicate.errors.invalidOption';
  return null;
}

/** The options sent to the server: e-commerce only while the module is on. */
export function startInput(options: DuplicateStartInput, ecommerceActive: boolean): DuplicateStartInput {
  return { ...options, ecommerce: ecommerceActive && options.ecommerce };
}

/** 0–100, whole. 0 while the total is still unknown (the sources load first). */
export function progressPercent(progress: { total: number; done: number } | null | undefined): number {
  if (!progress || !(progress.total > 0)) return 0;
  const pct = Math.round((Math.max(0, progress.done) / progress.total) * 100);
  return Math.min(100, pct);
}

/** The number of contents the summary will process (content types, then e-commerce items). */
export function summaryTotals(summary: DuplicateSummary): { contents: number; ecommerce: number } {
  const contents = summary.contentTypes.reduce((n, t) => n + (t.count || 0), 0);
  const ecommerce = summary.ecommerce
    ? Object.values(summary.ecommerce).reduce((n, v) => n + (v || 0), 0)
    : 0;
  return { contents, ecommerce };
}

const ECOMMERCE_KEYS: (keyof DuplicateEcommerceCounts)[] = [
  'products',
  'variants',
  'categories',
  'collections',
  'tags',
  'emailTemplates',
];

/** The e-commerce lines of the summary, in a fixed order (label key + count). */
export function ecommerceRows(
  counts: DuplicateEcommerceCounts | undefined
): { key: keyof DuplicateEcommerceCounts; labelKey: string; count: number }[] {
  if (!counts) return [];
  return ECOMMERCE_KEYS.map((key) => ({
    key,
    labelKey: `duplicate.summary.ecommerce.${key}`,
    count: counts[key] ?? 0,
  }));
}

const COUNT_KEYS: (keyof DuplicateCounts)[] = ['duplicated', 'replaced', 'skipped', 'untranslated', 'failed'];

/** The report's count lines, in a fixed order (label key + value). */
export function reportCounts(
  counts: Partial<DuplicateCounts> | undefined
): { key: keyof DuplicateCounts; labelKey: string; value: number }[] {
  return COUNT_KEYS.map((key) => ({
    key,
    labelKey: `duplicate.report.counts.${key}`,
    value: counts?.[key] ?? 0,
  }));
}

const ECOMMERCE_PREFIX = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const PLUGIN_PREFIX = 'plugin::littlebox-strapi-suite.';

/**
 * A readable name for a content type uid: the summary's display name when known, otherwise the
 * uid without its prefix (`api::article.article` → `article`, e-commerce
 * `…ltb-st-module-ecommerce-product-translation` → `product-translation`). Empty for the run itself.
 */
export function contentTypeLabel(uid: string, names: Record<string, string> = {}): string {
  if (uid === 'run') return '';
  if (names[uid]) return names[uid];
  if (uid.startsWith(ECOMMERCE_PREFIX)) return uid.slice(ECOMMERCE_PREFIX.length);
  if (uid.startsWith(PLUGIN_PREFIX)) return uid.slice(PLUGIN_PREFIX.length);
  const match = /^api::([^.]+)\.([^.]+)$/.exec(uid);
  if (match) return match[1] === match[2] ? match[1] : `${match[1]}.${match[2]}`;
  return uid;
}

/** The document a progress line or a failure names: its title, else its id. */
export function documentLabel(item: { documentId: string; title?: string }): string {
  return (item.title && item.title.trim()) || item.documentId || '';
}

/** "Content type · document" for the progress view; empty when nothing is being processed. */
export function currentLabel(current: DuplicateCurrent | null | undefined, names: Record<string, string> = {}): string {
  if (!current) return '';
  return [contentTypeLabel(current.uid, names), documentLabel(current)].filter(Boolean).join(' · ');
}

/** The failures table rows (a stable key, content type, document, reason, and whether it is a note). */
export function failureRows(
  failures: DuplicateFailure[] | undefined,
  names: Record<string, string> = {}
): { key: string; contentType: string; document: string; reason: string; note: boolean }[] {
  return (failures ?? []).map((f, i) => ({
    key: `${i}-${f.uid}-${f.documentId}`,
    contentType: contentTypeLabel(f.uid, names),
    document: documentLabel(f),
    reason: f.reason,
    note: f.kind === 'note',
  }));
}

/** Display names known from a summary, keyed by uid. */
export function namesFromSummary(summary: DuplicateSummary | null | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  summary?.contentTypes.forEach((t) => {
    names[t.uid] = t.displayName;
  });
  return names;
}

/** The newest run, or null without any (the list comes newest first). */
export function latestRun(runs: DuplicateRun[] | null | undefined): DuplicateRun | null {
  return runs && runs.length ? runs[0] : null;
}

export const isRunning = (run: DuplicateRun | null | undefined): boolean => run?.status === 'RUNNING';

/**
 * The translation key for a failed request. The server answers `{ code }` (409 RUN_IN_PROGRESS,
 * 400 invalid_locale / invalid_option); the admin fetch client keeps that body only when it holds
 * an `error`, so the HTTP status is the fallback.
 */
export function errorMessageKey(err: unknown): string {
  const e = err as any;
  const data = e?.response?.data;
  const code: unknown = data?.code ?? data?.error?.details?.code ?? data?.error?.code;
  if (code === 'RUN_IN_PROGRESS') return 'duplicate.errors.runInProgress';
  if (code === 'invalid_locale') return 'duplicate.errors.invalidLocale';
  if (code === 'invalid_option') return 'duplicate.errors.invalidOption';
  const status = typeof e?.status === 'number' ? e.status : data?.error?.status;
  if (status === 409) return 'duplicate.errors.runInProgress';
  if (status === 400) return 'duplicate.errors.invalidRequest';
  if (status === 403) return 'duplicate.errors.forbidden';
  return 'duplicate.errors.generic';
}
