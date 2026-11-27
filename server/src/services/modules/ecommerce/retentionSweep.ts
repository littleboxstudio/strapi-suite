import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';

/** How often the sweep runs. It also runs shortly after Strapi starts. */
export const SWEEP_INTERVAL_MS = 24 * 3_600_000;
/** Delay of the first run after boot, so it does not compete with the start-up work. */
export const SWEEP_FIRST_RUN_MS = 60_000;
/** Batches (of up to 100 rows) per purge in one run; the rest waits for the next run. */
export const SWEEP_MAX_BATCHES = 100;

type Purger = { purgeExpired(limit?: number): Promise<number> };

const PURGERS = [
  'EcommerceStorefrontSessionService',
  'EcommerceCustomerSessionService',
  'EcommerceCustomerTokenService',
] as const;

/**
 * Deletes expired guest checkout sessions, customer sessions and account link tokens. The inline
 * purges only run when sessions open; this covers a store without traffic. Each purge deletes
 * in batches until a batch comes back short. Every delete is conditional, so concurrent runs
 * (several Strapi instances) are harmless. Never logs row contents.
 */
export async function runRetentionSweep(
  strapi: Core.Strapi,
  maxBatches = SWEEP_MAX_BATCHES
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const name of PURGERS) {
    let total = 0;
    try {
      const service = strapi.plugin(PLUGIN_ID).service(name) as Purger;
      for (let i = 0; i < maxBatches; i++) {
        const n = await service.purgeExpired();
        total += n;
        if (n < 100) break;
      }
    } catch (e) {
      strapi.log?.error?.(
        `[ecommerce] retention sweep failed (${name}): ${e instanceof Error ? e.name : typeof e}`
      );
    }
    totals[name] = total;
  }
  return totals;
}

let timers: { first: NodeJS.Timeout; interval: NodeJS.Timeout } | null = null;

/** Schedules the sweep (first run after a minute, then daily). Idempotent; stop with `stopRetentionSweep`. */
export function startRetentionSweep(strapi: Core.Strapi): void {
  if (timers) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runRetentionSweep(strapi);
    } finally {
      running = false;
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
