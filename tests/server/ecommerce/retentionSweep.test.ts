import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runRetentionSweep,
  startRetentionSweep,
  stopRetentionSweep,
  SWEEP_FIRST_RUN_MS,
  SWEEP_INTERVAL_MS,
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

const makeStrapi = (services: Record<string, any>) => {
  const error = vi.fn();
  const strapi: any = {
    plugin: () => ({ service: (name: string) => services[name] }),
    log: { error },
  };
  return { strapi, error };
};

describe('runRetentionSweep', () => {
  it('purges each table in batches until a batch comes back short', async () => {
    const guest = purger(250);
    const customer = purger(0);
    const tokens = purger(100);
    const { strapi } = makeStrapi({
      EcommerceStorefrontSessionService: guest,
      EcommerceCustomerSessionService: customer,
      EcommerceCustomerTokenService: tokens,
    });
    expect(await runRetentionSweep(strapi)).toEqual({
      EcommerceStorefrontSessionService: 250,
      EcommerceCustomerSessionService: 0,
      EcommerceCustomerTokenService: 100,
    });
    expect(guest.purgeExpired).toHaveBeenCalledTimes(3);
    expect(customer.purgeExpired).toHaveBeenCalledTimes(1);
    expect(tokens.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('stops at the batch cap and leaves the rest for the next run', async () => {
    const guest = purger(10_000);
    const { strapi } = makeStrapi({
      EcommerceStorefrontSessionService: guest,
      EcommerceCustomerSessionService: purger(0),
      EcommerceCustomerTokenService: purger(0),
    });
    expect((await runRetentionSweep(strapi, 3)).EcommerceStorefrontSessionService).toBe(300);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(3);
  });

  it('a failing purge is logged by error name only and the others still run', async () => {
    const tokens = purger(5);
    const { strapi, error } = makeStrapi({
      EcommerceStorefrontSessionService: {
        purgeExpired: async () => {
          throw new TypeError('secret detail');
        },
      },
      EcommerceCustomerSessionService: purger(0),
      EcommerceCustomerTokenService: tokens,
    });
    const totals = await runRetentionSweep(strapi);
    expect(totals.EcommerceCustomerTokenService).toBe(5);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('TypeError');
    expect(error.mock.calls[0][0]).not.toContain('secret detail');
  });
});

describe('startRetentionSweep', () => {
  afterEach(() => {
    stopRetentionSweep();
    vi.useRealTimers();
  });

  it('runs a minute after boot, then daily, and stops on destroy', async () => {
    vi.useFakeTimers();
    const guest = purger(0);
    const { strapi } = makeStrapi({
      EcommerceStorefrontSessionService: guest,
      EcommerceCustomerSessionService: purger(0),
      EcommerceCustomerTokenService: purger(0),
    });
    startRetentionSweep(strapi);
    startRetentionSweep(strapi); // idempotent
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_MS - 1);
    expect(guest.purgeExpired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(2);
    stopRetentionSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(guest.purgeExpired).toHaveBeenCalledTimes(2);
  });
});
