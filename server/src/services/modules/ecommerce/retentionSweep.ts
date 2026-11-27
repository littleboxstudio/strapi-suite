import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import type { CronRunFailure } from './cronRuns';

/** Name of the job in the cron log. */
export const RETENTION_JOB = 'retention-sweep';
/** How often the sweep runs. It also runs shortly after Strapi starts. */
export const SWEEP_INTERVAL_MS = 24 * 3_600_000;
/** Delay of the first run after boot, so it does not compete with the start-up work. */
export const SWEEP_FIRST_RUN_MS = 60_000;
/** Batches (of up to 100 rows) per purge in one run; the rest waits for the next run. */
export const SWEEP_MAX_BATCHES = 100;
/**
 * A run still going after this long is recorded as TIMEOUT and stops blocking the next runs
 * (a database call that never settles would otherwise skip every run until a restart).
 */
export const SWEEP_TIMEOUT_MS = 10 * 60_000;

type Purger = { purgeExpired(limit?: number): Promise<number> };

/** Each purge: its key in the run results and the service that does it. */
const TASKS = [
  { key: 'guestSessions', service: 'EcommerceStorefrontSessionService' },
  { key: 'customerSessions', service: 'EcommerceCustomerSessionService' },
  { key: 'linkTokens', service: 'EcommerceCustomerTokenService' },
] as const;

export type SweepOutcome = { results: Record<string, number>; failures: CronRunFailure[] };

const errorName = (e: unknown) => (e instanceof Error ? e.name : typeof e);

/**
 * Deletes expired guest checkout sessions, customer sessions and account link tokens. The inline
 * purges only run when sessions open; this covers a store without traffic. Each purge deletes
 * in batches until a batch comes back short. Every delete is conditional, so concurrent runs
 * (several Strapi instances) are harmless. Never logs row contents, only error names.
 */
export async function runRetentionSweep(
  strapi: Core.Strapi,
  maxBatches = SWEEP_MAX_BATCHES
): Promise<SweepOutcome> {
  const results: Record<string, number> = {};
  const failures: CronRunFailure[] = [];
  for (const task of TASKS) {
    let total = 0;
    try {
      const service = strapi.plugin(PLUGIN_ID).service(task.service) as Purger;
      for (let i = 0; i < maxBatches; i++) {
        const n = await service.purgeExpired();
        total += n;
        if (n < 100) break;
      }
    } catch (e) {
      failures.push({ task: task.key, error: errorName(e) });
      strapi.log?.error?.(`[ecommerce] retention sweep failed (${task.key}): ${errorName(e)}`);
    }
    results[task.key] = total;
  }
  return { results, failures };
}

type CronRuns = {
  start(job: string): Promise<number>;
  finish(
    id: number,
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'INTERRUPTED',
    outcome?: Partial<SweepOutcome>
  ): Promise<void>;
  interruptStale(olderThanMs: number): Promise<number>;
};

let timers: { first: NodeJS.Timeout; interval: NodeJS.Timeout } | null = null;

/**
 * Schedules the sweep (first run after a minute, then daily) and logs each run in the cron log.
 * Idempotent; stop with `stopRetentionSweep`. A run never overlaps the previous one, unless the
 * previous one passed `SWEEP_TIMEOUT_MS`: it is then recorded as TIMEOUT and the next run goes.
 */
export function startRetentionSweep(strapi: Core.Strapi): void {
  if (timers) return;
  const runs = (): CronRuns => strapi.plugin(PLUGIN_ID).service('EcommerceCronRunService');
  const logError = (what: string) => (e: unknown) =>
    strapi.log?.error?.(`[ecommerce] cron log ${what} failed: ${errorName(e)}`);
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    let runId: number | null = null;
    try {
      await runs().interruptStale(SWEEP_TIMEOUT_MS);
      runId = await runs().start(RETENTION_JOB);
    } catch (e) {
      logError('write')(e);
    }
    let settled = false;
    const settle = (
      status: 'SUCCESS' | 'FAILED' | 'TIMEOUT',
      outcome?: Partial<SweepOutcome>
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      running = false;
      if (runId !== null) runs().finish(runId, status, outcome).catch(logError('write'));
    };
    const guard = setTimeout(() => {
      strapi.log?.error?.('[ecommerce] retention sweep timed out');
      settle('TIMEOUT');
    }, SWEEP_TIMEOUT_MS);
    guard.unref?.();
    try {
      const outcome = await runRetentionSweep(strapi);
      settle(outcome.failures.length ? 'FAILED' : 'SUCCESS', outcome);
    } catch (e) {
      settle('FAILED', { failures: [{ task: 'sweep', error: errorName(e) }] });
    }
  };

  const first = setTimeout(() => void run(), SWEEP_FIRST_RUN_MS);
  const interval = setInterval(() => void run(), SWEEP_INTERVAL_MS);
  // Never keeps the process alive on shutdown.
  first.unref?.();
  interval.unref?.();
  timers = { first, interval };
}

export function stopRetentionSweep(): void {
  if (!timers) return;
  clearTimeout(timers.first);
  clearInterval(timers.interval);
  timers = null;
}
