import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, type LtbConfigs } from '../../../config';
import { normalizeEmail } from './domain/email';

/**
 * Converts the e-mail list eligibility of promotions saved before customer eligibility
 * (`{ mode: 'EMAILS', emails }`) into `{ mode: 'CUSTOMERS', customerIds }`: each e-mail matching a
 * customer's `emailNormalized` gives that customer; e-mails without a customer are dropped (none
 * left: the promotion applies to nobody, and a warning names the promotion id only). Writes only
 * `eligibility` (the `version` is not bumped); idempotent, since a converted row is no longer EMAILS.
 */
export async function migratePromotionEligibility(
  strapi: Core.Strapi,
  batchSize = 100
): Promise<{ migrated: number }> {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const uids = config.uuid.modules.ecommerce;
  const promotions = strapi.db.query(uids.promotion);
  let migrated = 0;
  let lastId = 0;
  for (;;) {
    // JSON columns cannot be filtered portably: the mode is checked here.
    const batch: any[] = await promotions.findMany({
      where: { id: { $gt: lastId } },
      select: ['id', 'eligibility'],
      orderBy: { id: 'asc' },
      limit: batchSize,
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    for (const row of batch) {
      const e = row.eligibility;
      if (!e || typeof e !== 'object' || e.mode !== 'EMAILS') continue;
      const listed: unknown[] = Array.isArray(e.emails) ? e.emails : [];
      const emails = [
        ...new Set(
          listed
            .filter((x): x is string => typeof x === 'string')
            .map((x) => normalizeEmail(x))
            .filter(Boolean)
        ),
      ];
      const customers: any[] = emails.length
        ? await strapi.db.query(uids.customer).findMany({
            where: { emailNormalized: { $in: emails } },
            select: ['id', 'emailNormalized'],
            orderBy: { id: 'asc' },
          })
        : [];
      // In the list's order; one customer per e-mail (the oldest when several share it).
      const byEmail = new Map<string, number>();
      for (const c of customers) if (!byEmail.has(c.emailNormalized)) byEmail.set(c.emailNormalized, c.id);
      const customerIds = [...new Set(emails.map((x) => byEmail.get(x)).filter((id): id is number => id !== undefined))];
      if (!customerIds.length) {
        strapi.log?.warn?.(
          `[ecommerce] promotion ${row.id}: no customer matches its e-mail list; it now applies to nobody`
        );
      }
      await promotions.update({ where: { id: row.id }, data: { eligibility: { mode: 'CUSTOMERS', customerIds } } });
      migrated++;
    }
  }
  return { migrated };
}
