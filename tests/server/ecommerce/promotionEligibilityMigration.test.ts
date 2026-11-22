import { describe, it, expect, vi } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';
import { migratePromotionEligibility } from '../../../server/src/services/modules/ecommerce/promotionEligibilityMigration';

const PROMOTION = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-promotion';
const CUSTOMER = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-customer';

function setup() {
  const db = createFakeDb([PROMOTION, CUSTOMER], {});
  const log = { warn: vi.fn() };
  const strapi: any = {
    log,
    db: { query: db.query },
    config: { get: () => ({ uuid: { modules: { ecommerce: { promotion: PROMOTION, customer: CUSTOMER } } } }) },
  };
  return { db, strapi, log, promotions: () => db.tables[PROMOTION] };
}

describe('migratePromotionEligibility', () => {
  it('converts e-mail lists to the matching customers, drops unmatched e-mails, then is idempotent', async () => {
    const { db, strapi, log, promotions } = setup();
    await db.query(CUSTOMER).create({ data: { email: 'Ana@Example.pt', emailNormalized: 'ana@example.pt' } });
    await db.query(CUSTOMER).create({ data: { email: 'bruno@example.pt', emailNormalized: 'bruno@example.pt' } });
    await db.query(PROMOTION).create({
      data: { name: 'VIP', version: 4, eligibility: { mode: 'EMAILS', emails: ['bruno@example.pt', ' ANA@example.pt ', 'nobody@example.pt'] } },
    });
    await db.query(PROMOTION).create({ data: { name: 'All', version: 1, eligibility: { mode: 'ALL' } } });
    await db.query(PROMOTION).create({
      data: { name: 'Lost', version: 2, eligibility: { mode: 'EMAILS', emails: ['secret@example.pt'] } },
    });
    await db.query(PROMOTION).create({
      data: { name: 'New', version: 1, eligibility: { mode: 'CUSTOMERS', customerIds: [1] } },
    });

    expect(await migratePromotionEligibility(strapi, 2)).toEqual({ migrated: 2 });

    const [vip, all, lost, fresh] = promotions();
    expect(vip).toMatchObject({ name: 'VIP', version: 4, eligibility: { mode: 'CUSTOMERS', customerIds: [2, 1] } });
    expect(all.eligibility).toEqual({ mode: 'ALL' });
    expect(lost).toMatchObject({ version: 2, eligibility: { mode: 'CUSTOMERS', customerIds: [] } });
    expect(fresh.eligibility).toEqual({ mode: 'CUSTOMERS', customerIds: [1] });

    // One warning, for the promotion that now applies to nobody: its id only, no e-mails.
    expect(log.warn).toHaveBeenCalledTimes(1);
    const msg = String(log.warn.mock.calls[0][0]);
    expect(msg).toContain(`promotion ${lost.id}`);
    expect(msg).not.toContain('@');

    const snapshot = JSON.stringify(promotions());
    expect(await migratePromotionEligibility(strapi)).toEqual({ migrated: 0 });
    expect(JSON.stringify(promotions())).toBe(snapshot);
  });
});
