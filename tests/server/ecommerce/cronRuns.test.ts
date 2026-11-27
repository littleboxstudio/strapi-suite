import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';
import EcommerceCronRunService, {
  CRON_RUNS_KEPT,
} from '../../../server/src/services/modules/ecommerce/cronRuns';

const RUN = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-cron-run';
const NOW = new Date('2026-11-27T10:00:00.000Z');
const MIN = 60_000;

const setup = () => {
  const db = createFakeDb([RUN], {});
  const strapi = { db, config: { get: () => ({ uuid: { modules: { ecommerce: { cronRun: RUN } } } }) } };
  return { svc: EcommerceCronRunService({ strapi } as never), rows: () => db.tables[RUN] };
};

describe('EcommerceCronRunService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('records a run and closes it with its counts', async () => {
    const { svc } = setup();
    const id = await svc.start('retention-sweep');
    vi.setSystemTime(new Date(NOW.getTime() + 5000));
    await svc.finish(id, 'SUCCESS', { results: { guestSessions: 3 }, failures: [] });
    expect(await svc.list()).toEqual([
      {
        id,
        job: 'retention-sweep',
        status: 'SUCCESS',
        startedAt: NOW.toISOString(),
        finishedAt: new Date(NOW.getTime() + 5000).toISOString(),
        results: { guestSessions: 3 },
        failures: [],
      },
    ]);
  });

  it('a late finish never overwrites a TIMEOUT', async () => {
    const { svc } = setup();
    const id = await svc.start('retention-sweep');
    await svc.finish(id, 'TIMEOUT');
    await svc.finish(id, 'SUCCESS', { results: { guestSessions: 9 } });
    const [run] = await svc.list();
    expect(run.status).toBe('TIMEOUT');
    expect(run.results).toEqual({});
  });

  it(`keeps and lists only the newest ${CRON_RUNS_KEPT} runs, newest first`, async () => {
    const { svc, rows } = setup();
    for (let i = 0; i < CRON_RUNS_KEPT + 5; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * MIN));
      await svc.start('retention-sweep');
    }
    expect(rows()).toHaveLength(CRON_RUNS_KEPT);
    const list = await svc.list();
    expect(list).toHaveLength(CRON_RUNS_KEPT);
    expect(list[0].startedAt).toBe(new Date(NOW.getTime() + (CRON_RUNS_KEPT + 4) * MIN).toISOString());
    expect(list[CRON_RUNS_KEPT - 1].startedAt).toBe(new Date(NOW.getTime() + 5 * MIN).toISOString());
  });

  it('marks INTERRUPTED only the RUNNING rows older than the limit', async () => {
    const { svc } = setup();
    const old = await svc.start('retention-sweep');
    vi.setSystemTime(new Date(NOW.getTime() + 20 * MIN));
    const recent = await svc.start('retention-sweep');
    expect(await svc.interruptStale(10 * MIN)).toBe(1);
    const byId = Object.fromEntries((await svc.list()).map((r) => [r.id, r.status]));
    expect(byId).toEqual({ [old]: 'INTERRUPTED', [recent]: 'RUNNING' });
  });
});
