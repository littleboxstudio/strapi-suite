import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

export type DuplicateRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'INTERRUPTED';
export type DuplicateCounts = {
  duplicated: number;
  replaced: number;
  skipped: number;
  untranslated: number;
  failed: number;
};
export type DuplicateCurrent = { uid: string; documentId: string; title?: string };
/**
 * A line of the run's report. Without `kind` it is a real failure (a content not duplicated, a fix
 * not applied, ...); `kind: 'note'` marks a relation left empty because its target is out of scope
 * or failed: notes are capped apart, so they never hide a real failure.
 */
export type DuplicateFailure = { uid: string; documentId: string; title?: string; reason: string; kind?: 'note' };
export type DuplicateProgress = { total: number; done: number; current: DuplicateCurrent | null };
export type DuplicateOptions = { existing?: string; status?: string; ecommerce?: boolean };
export type DuplicateRunView = {
  id: number;
  status: DuplicateRunStatus;
  sourceLocale: string;
  targetLocale: string;
  options: DuplicateOptions;
  startedAt: string;
  finishedAt: string | null;
  userId: string | null;
  userName: string | null;
  progress: DuplicateProgress;
  counts: DuplicateCounts;
  failures: DuplicateFailure[];
  /** The distinct errors the AI returned during the run (no secrets), newest last. */
  aiErrors: string[];
};

/** At most this many distinct AI errors are kept per run. */
export const DUPLICATE_AI_ERRORS_KEPT = 10;

const toAiErrors = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((e): e is string => typeof e === 'string' && e.trim() !== '').map((e) => e.slice(0, 300)))].slice(
        0,
        DUPLICATE_AI_ERRORS_KEPT
      )
    : [];

/** Only the newest runs are kept (and listed). */
export const DUPLICATE_RUNS_KEPT = 20;
/** At most this many failures are kept per run. */
export const DUPLICATE_FAILURES_KEPT = 500;
/** At most this many relation notes are kept per run, apart from the failures. */
export const DUPLICATE_NOTES_KEPT = 500;

const STATUSES: DuplicateRunStatus[] = ['RUNNING', 'SUCCESS', 'FAILED', 'INTERRUPTED'];
const COUNT_KEYS: (keyof DuplicateCounts)[] = ['duplicated', 'replaced', 'skipped', 'untranslated', 'failed'];

export const emptyCounts = (): DuplicateCounts => ({
  duplicated: 0,
  replaced: 0,
  skipped: 0,
  untranslated: 0,
  failed: 0,
});

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const toCurrent = (v: unknown): DuplicateCurrent | null => {
  if (!isRecord(v) || typeof v.uid !== 'string' || typeof v.documentId !== 'string') return null;
  return { uid: v.uid, documentId: v.documentId, ...(typeof v.title === 'string' ? { title: v.title } : {}) };
};

const toCounts = (v: unknown): DuplicateCounts => {
  const counts = emptyCounts();
  if (!isRecord(v)) return counts;
  for (const key of COUNT_KEYS) if (isInt(v[key])) counts[key] = v[key];
  return counts;
};

const toFailures = (v: unknown): DuplicateFailure[] =>
  Array.isArray(v)
    ? v
        .filter(
          (f) => isRecord(f) && typeof f.uid === 'string' && typeof f.documentId === 'string' && typeof f.reason === 'string'
        )
        .map((f: any) => ({
          uid: f.uid,
          documentId: f.documentId,
          ...(typeof f.title === 'string' ? { title: f.title } : {}),
          reason: f.reason,
          ...(f.kind === 'note' ? { kind: 'note' as const } : {}),
        }))
    : [];

/** Failures first, then notes, each list capped on its own (the first ones are kept). */
const capFailures = (list: DuplicateFailure[]): DuplicateFailure[] => [
  ...list.filter((f) => f.kind !== 'note').slice(0, DUPLICATE_FAILURES_KEPT),
  ...list.filter((f) => f.kind === 'note').slice(0, DUPLICATE_NOTES_KEPT),
];

const toProgress = (v: unknown): DuplicateProgress => {
  if (!isRecord(v)) return { total: 0, done: 0, current: null };
  return {
    total: isInt(v.total) ? v.total : 0,
    done: isInt(v.done) ? v.done : 0,
    current: toCurrent(v.current),
  };
};

const toView = (row: any): DuplicateRunView => ({
  id: row.id,
  status: STATUSES.includes(row.status) ? row.status : 'RUNNING',
  sourceLocale: String(row.sourceLocale ?? ''),
  targetLocale: String(row.targetLocale ?? ''),
  options: isRecord(row.options) ? row.options : {},
  startedAt: iso(row.startedAt) ?? '',
  finishedAt: iso(row.finishedAt),
  userId: str(row.userId),
  userName: str(row.userName),
  progress: toProgress(row.progress),
  counts: toCounts(row.counts),
  failures: toFailures(row.failures),
  aiErrors: toAiErrors(row.aiErrors),
});

export type DuplicateRunStartInput = {
  sourceLocale: string;
  targetLocale: string;
  options: DuplicateOptions;
  userId: string | null;
  userName: string | null;
  total: number;
};

export type DuplicateProgressPatch = {
  done?: number;
  total?: number;
  current?: DuplicateCurrent | null;
  /** Merged into the stored counts. */
  counts?: Partial<DuplicateCounts>;
  failure?: DuplicateFailure;
  failures?: DuplicateFailure[];
  /** Added to the stored AI errors (duplicates dropped). */
  aiErrors?: string[];
};

/**
 * The log of the duplication runs: one row per run, newest 20 kept, progress written after each
 * document so the admin can follow it (and a restart can tell it was cut short).
 */
const DuplicateRunService = ({ strapi }: { strapi: Core.Strapi }) => {
  const query = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return strapi.db.query(config.uuid.modules.duplicateRun);
  };

  const prune = async (): Promise<void> => {
    const old: { id: number }[] = await query().findMany({
      select: ['id'],
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      offset: DUPLICATE_RUNS_KEPT,
      limit: 1000,
    });
    if (old.length) await query().deleteMany({ where: { id: { $in: old.map((r) => r.id) } } });
  };

  return {
    async start(input: DuplicateRunStartInput): Promise<number> {
      const row = await query().create({
        data: {
          status: 'RUNNING',
          sourceLocale: input.sourceLocale,
          targetLocale: input.targetLocale,
          options: input.options ?? {},
          startedAt: new Date(),
          userId: input.userId ?? null,
          userName: input.userName ?? null,
          progress: { total: input.total ?? 0, done: 0, current: null },
          counts: emptyCounts(),
          failures: [],
          aiErrors: [],
        },
      });
      // Pruning is best-effort: the run row exists, so failing here would leave it RUNNING with no job.
      try {
        await prune();
      } catch (e) {
        strapi.log?.warn?.(`[duplicate] old runs could not be pruned: ${e instanceof Error ? e.name : typeof e}`);
      }
      return row.id;
    },

    /** Writes the progress of a RUNNING run (a closed run is never reopened). */
    async progress(id: number, patch: DuplicateProgressPatch): Promise<void> {
      const row = await query().findOne({ where: { id } });
      if (!row || row.status !== 'RUNNING') return;
      const progress = toProgress(row.progress);
      if (isInt(patch.done)) progress.done = patch.done;
      if (isInt(patch.total)) progress.total = patch.total;
      if (patch.current !== undefined) progress.current = toCurrent(patch.current);
      const counts = toCounts(row.counts);
      for (const key of COUNT_KEYS) {
        const value = patch.counts?.[key];
        if (isInt(value)) counts[key] = value;
      }
      const added = [...(patch.failure ? [patch.failure] : []), ...(patch.failures ?? [])];
      const failures = capFailures([...toFailures(row.failures), ...toFailures(added)]);
      await query().updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          progress,
          counts,
          failures,
          ...(patch.aiErrors?.length ? { aiErrors: toAiErrors([...toAiErrors(row.aiErrors), ...patch.aiErrors]) } : {}),
        },
      });
    },

    /** Closes a RUNNING run (an INTERRUPTED one stays as it is). */
    async finish(id: number, status: Exclude<DuplicateRunStatus, 'RUNNING' | 'INTERRUPTED'>): Promise<void> {
      const row = await query().findOne({ where: { id } });
      if (!row || row.status !== 'RUNNING') return;
      await query().updateMany({
        where: { id, status: 'RUNNING' },
        data: { status, finishedAt: new Date(), progress: { ...toProgress(row.progress), current: null } },
      });
    },

    /**
     * Every RUNNING run becomes INTERRUPTED. Called at boot: no run of this process exists yet, so a
     * RUNNING row was left by a process that stopped.
     */
    async interruptAll(): Promise<number> {
      const res: any = await query().updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'INTERRUPTED', finishedAt: new Date() },
      });
      return isInt(res?.count) ? res.count : 0;
    },

    async running(): Promise<DuplicateRunView | null> {
      const [row] = await query().findMany({
        where: { status: 'RUNNING' },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        limit: 1,
      });
      return row ? toView(row) : null;
    },

    /** The newest runs first, at most `DUPLICATE_RUNS_KEPT`. */
    async list(): Promise<DuplicateRunView[]> {
      const rows = await query().findMany({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        limit: DUPLICATE_RUNS_KEPT,
      });
      return rows.map(toView);
    },
  };
};

export default DuplicateRunService;
