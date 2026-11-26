import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, type LtbConfigs } from '../../../config';

const PAGE = 500;

function uidsOf(strapi: Core.Strapi) {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  return config.uuid.modules.ecommerce;
}

/**
 * Prepares customers saved before accounts existed. Idempotent; logs counts only.
 * - Rows without an `accountType` become GUEST, unverified and unblocked.
 * - For customers sharing an `emailNormalized`, orders and store credits move to the oldest id;
 *   the other rows stay (no unique index can be created over existing duplicates).
 * Store credits are re-linked through their `customer` relation; order links likewise.
 */
export async function migrateCustomerAccounts(
  strapi: Core.Strapi
): Promise<{ normalized: number; relinked: number }> {
  const uids = uidsOf(strapi);
  const customers = strapi.db.query(uids.customer);

  const res: any = await customers.updateMany({
    where: { accountType: { $null: true } },
    data: { accountType: 'GUEST', emailVerified: false, blocked: false },
  });
  const normalized: number = res?.count ?? 0;

  let relinked = 0;
  const oldest = new Map<string, number>();
  let lastId = 0;
  for (;;) {
    const batch: any[] = await customers.findMany({
      where: { id: { $gt: lastId } },
      select: ['id', 'emailNormalized'],
      orderBy: { id: 'asc' },
      limit: PAGE,
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    for (const row of batch) {
      const key = row.emailNormalized;
      if (typeof key !== 'string' || !key) continue;
      const keeper = oldest.get(key);
      if (keeper === undefined) {
        oldest.set(key, row.id);
        continue;
      }
      for (const uid of [uids.order, uids.storeCredit]) {
        const rows: any[] = await strapi.db.query(uid).findMany({
          where: { customer: { id: row.id } },
          select: ['id'],
        });
        for (const r of rows) {
          await strapi.db.query(uid).update({ where: { id: r.id }, data: { customer: keeper } });
          relinked += 1;
        }
      }
    }
  }

  if (normalized || relinked) {
    strapi.log?.info?.(`[ecommerce] customer accounts migration: normalized=${normalized} relinked=${relinked}`);
  }
  return { normalized, relinked };
}

/**
 * Gives every GUEST customer without a password hash a random one (so a guest row can never be
 * logged into). Does nothing when the password service is unavailable. Catches its own errors, so
 * it is safe to start with `void` from bootstrap. Returns how many rows were filled.
 */
export async function fillGuestHashes(
  strapi: Core.Strapi,
  opts: { batch?: number } = {}
): Promise<number> {
  let filled = 0;
  try {
    const passwords: any = strapi.plugin(PLUGIN_ID).service('EcommercePasswordService');
    if (!passwords.available()) return 0;
    const batchSize = opts.batch ?? 50;
    const customers = strapi.db.query(uidsOf(strapi).customer);
    for (;;) {
      // Filled rows leave the filter, so each pass starts from the top.
      const batch: any[] = await customers.findMany({
        where: { accountType: 'GUEST', passwordHash: { $null: true } },
        select: ['id'],
        orderBy: { id: 'asc' },
        limit: batchSize,
      });
      if (batch.length === 0) break;
      for (const row of batch) {
        const { hash, pepperVersion } = await passwords.randomGuestHash();
        // A row that would stay in the filter would make this loop spin forever.
        if (typeof hash !== 'string' || !hash) throw new Error('EMPTY_HASH');
        await customers.update({
          where: { id: row.id },
          data: { passwordHash: hash, passwordPepperVersion: pepperVersion },
        });
        filled += 1;
      }
    }
  } catch (e) {
    strapi.log?.warn?.('[ecommerce] guest password hash fill stopped: ' + (e instanceof Error ? e.name : typeof e));
    return filled;
  }
  if (filled) strapi.log?.info?.(`[ecommerce] guest password hashes filled=${filled}`);
  return filled;
}
