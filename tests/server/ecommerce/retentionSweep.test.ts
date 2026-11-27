import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RETENTION_JOB,
  runRetentionSweep,
  startRetentionSweep,
  stopRetentionSweep,
  SWEEP_FIRST_RUN_MS,
  SWEEP_INTERVAL_MS,
  SWEEP_TIMEOUT_MS,
} from '../../../server/src/services/modules/ecommerce/retentionSweep';

/** A purger that has `pending` rows and deletes up to 100 per call. */
const purger = (pending: number) => {
  let left = pending;
  return {
    purgeExpired: vi.fn(async () => {
      const n = Math.min(100, left);
      left -= n;
      return n;
    }),
  };
};

/** An in-memory cron log with the service's conditional finish. */
const cronLog = () => {
  const rows: any[] = [];
  return {
    rows,
    start: vi.fn(async (job: string) => {
      rows.push({ id: rows.length + 1, job, status: 'RUNNING' });
      return rows.length;
    }),
    finish: vi.fn(async (id: number, status: string, outcome: any = {}) => {
      const row = rows.find((r) => r.id === id);
      if (row?.status === 'RUNNING') Object.assign(row, { status, ...outcome });
    }),
    interruptStale: vi.fn(async () => 0),
  };
};

const makeStrapi = (services: Record<string, any>) => {
  const error = vi.fn();
  const log = cronLog();
  const all = { EcommerceCronRunService: log, ...services };
  const strapi: any = {
    plugin: () => ({ service: (name: string) => all[name] }),
    log: { error },
  };
  return { strapi, error, log };
};

const purgers = (guest: any, customer = purger(0), tokens = purger(0)) => ({
  EcommerceStorefrontSessionService: guest,
  EcommerceCustomerSessionService: customer,
  EcommerceCustomerTokenService: tokens,
});

describe('runRetentionSweep', () => {
  it('purges each table in batches until a batch comes back short', async () => {
    const guest = purger(250);
    const customer = purger(0);
    const tokens = purger(100);
    const { strapi } = makeStrapi(purgers(guest, customer, tokens));
    expect(await runRetentionSweep(strapi)).toEqual({
      results: { guestSessions: 250, customerSessions: 0, linkTokens: 100 },
      failures: [],
    });
    expect(guest.purgeExpired).toHaveBeenCalledTimes(3);
    expect(customer.purgeExpired).toHaveBeenCalledTimes(1);
    expect(tokens.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('stops at the batch cap and leaves the rest for the next run', async () => {
    const guest = purger(10_000);
    const { strapi } = makeStrapi(purgers(guest));
    expect((await runRetentionSweep(strapi, 3)).results.guestSessions).toBe(300);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(3);
  });

  it('a failing purge is recorded and logged by error name only; the others still run', async () => {
    const tokens = purger(5);
    const failing = {
      purgeExpired: async () => {
        throw new TypeError('secret detail');
      },
    };
    const { strapi, error } = makeStrapi(purgers(failing, purger(0), tokens));
    const outcome = await runRetentionSweep(strapi);
    expect(outcome.results.linkTokens).toBe(5);
    expect(outcome.failures).toEqual([{ task: 'guestSessions', error: 'TypeError' }]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).not.toContain('secret detail');
  });
});

describe('startRetentionSweep', () => {
  afterEach(() => {
    stopRetentionSweep();
    vi.useRealTimers();
  });

  it('runs a minute after boot, then daily, logs each run, and stops on destroy', async () => {
    vi.useFakeTimers();
    const guest = purger(30);
    const { strapi, log } = makeStrapi(purgers(guest));
    startRetentionSweep(strapi);
    startRetentionSweep(strapi); // idempotent
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_MS - 1);
    expect(guest.purgeExpired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(1);
    expect(log.interruptStale).toHaveBeenCalledWith(SWEEP_TIMEOUT_MS);
    expect(log.rows[0]).toMatchObject({
      job: RETENTION_JOB,
      status: 'SUCCESS',
      results: { guestSessions: 30, customerSessions: 0, linkTokens: 0 },
      failures: [],
    });
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(2);
    expect(log.rows).toHaveLength(2);
    stopRetentionSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('records FAILED when a purge fails', async () => {
    vi.useFakeTimers();
    const failing = { purgeExpired: async () => Promise.reject(new RangeError('x')) };
    const { strapi, log } = makeStrapi(purgers(failing));
    startRetentionSweep(strapi);
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_MS);
    expect(log.rows[0]).toMatchObject({
      status: 'FAILED',
      failures: [{ task: 'guestSessions', error: 'RangeError' }],
    });
  });

  it('a run that never settles is recorded as TIMEOUT and no longer blocks the next run', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const hanging = {
      purgeExpired: vi.fn(() => {
        calls++;
        // The first run hangs forever; later runs work.
        return calls === 1 ? new Promise<number>(() => {}) : Promise.resolve(0);
      }),
    };
    const { strapi, log, error } = makeStrapi(purgers(hanging));
    startRetentionSweep(strapi);
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_MS);
    expect(log.rows[0].status).toBe('RUNNING');
    await vi.advanceTimersByTimeAsync(SWEEP_TIMEOUT_MS);
    expect(log.rows[0].status).toBe('TIMEOUT');
    expect(error).toHaveBeenCalledWith('[ecommerce] retention sweep timed out');
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(hanging.purgeExpired).toHaveBeenCalledTimes(2);
    expect(log.rows[1].status).toBe('SUCCESS');
  });

  it('the sweep still runs when the cron log cannot be written', async () => {
    vi.useFakeTimers();
    const guest = purger(0);
    const { strapi, log, error } = makeStrapi(purgers(guest));
    log.start.mockRejectedValue(new Error('db down'));
    startRetentionSweep(strapi);
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_MS);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(1);
    expect(log.finish).not.toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toContain('cron log write failed: Error');
  });
});
