import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

export type CronRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'INTERRUPTED';
export type CronRunFailure = { task: string; error: string };
export type CronRunView = {
  id: number;
  job: string;
  status: CronRunStatus;
  startedAt: string;
  finishedAt: string | null;
  results: Record<string, number>;
  failures: CronRunFailure[];
};

/** Only the newest runs are kept (and listed). */
export const CRON_RUNS_KEPT = 50;

const STATUSES: CronRunStatus[] = ['RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'INTERRUPTED'];
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const toView = (row: any): CronRunView => ({
  id: row.id,
  job: String(row.job ?? ''),
  status: STATUSES.includes(row.status) ? row.status : 'RUNNING',
  startedAt: iso(row.startedAt) ?? '',
  finishedAt: iso(row.finishedAt),
  results: isRecord(row.results)
    ? Object.fromEntries(
        Object.entries(row.results).filter(([, n]) => Number.isInteger(n)) as [string, number][]
      )
    : {},
  failures: Array.isArray(row.failures)
    ? row.failures
        .filter((f: unknown) => isRecord(f) && typeof f.task === 'string' && typeof f.error === 'string')
        .map((f: any) => ({ task: f.task, error: f.error }))
    : [],
});

/**
 * The log of the scheduled jobs (retention sweep): one row per run, newest 50 kept. Rows hold
 * counts and error names only, never data from the purged rows.
 */
const EcommerceCronRunService = ({ strapi }: { strapi: Core.Strapi }) => {
  const query = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return strapi.db.query(config.uuid.modules.ecommerce.cronRun);
  };

  /** Deletes every run older than the newest `CRON_RUNS_KEPT`. */
  const prune = async (): Promise<void> => {
    const old: { id: number }[] = await query().findMany({
      select: ['id'],
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      offset: CRON_RUNS_KEPT,
      limit: 1000,
    });
    if (old.length) await query().deleteMany({ where: { id: { $in: old.map((r) => r.id) } } });
  };

  return {
    /** Records a run as RUNNING and returns its id. */
    async start(job: string): Promise<number> {
      const row = await query().create({
        data: { job, status: 'RUNNING', startedAt: new Date(), results: {}, failures: [] },
      });
      await prune();
      return row.id;
    },

    /** Closes a run; only a RUNNING row changes, so a late finish never overwrites a TIMEOUT. */
    async finish(
      id: number,
      status: Exclude<CronRunStatus, 'RUNNING'>,
      outcome: { results?: Record<string, number>; failures?: CronRunFailure[] } = {}
    ): Promise<void> {
      await query().updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          status,
          finishedAt: new Date(),
          ...(outcome.results ? { results: outcome.results } : {}),
          ...(outcome.failures ? { failures: outcome.failures } : {}),
        },
      });
    },

    /**
     * Runs left RUNNING by a process that stopped (crash, restart) become INTERRUPTED once they
     * are older than `olderThanMs`, so a run of another instance in progress is left alone.
     */
    async interruptStale(olderThanMs: number): Promise<number> {
      const res: any = await query().updateMany({
        where: { status: 'RUNNING', startedAt: { $lt: new Date(Date.now() - olderThanMs) } },
        data: { status: 'INTERRUPTED' },
      });
      return Number.isInteger(res?.count) ? res.count : 0;
    },

    /** The newest runs first, at most `CRON_RUNS_KEPT`. */
    async list(): Promise<CronRunView[]> {
      const rows = await query().findMany({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        limit: CRON_RUNS_KEPT,
      });
      return rows.map(toView);
    },
  };
};

export default EcommerceCronRunService;
