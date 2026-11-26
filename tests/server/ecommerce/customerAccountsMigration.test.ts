import { describe, it, expect, vi } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';
import {
  migrateCustomerAccounts,
  fillGuestHashes,
} from '../../../server/src/services/modules/ecommerce/customerAccountsMigration';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const CUSTOMER = P + 'customer';
const ORDER = P + 'order';
const CREDIT = P + 'store-credit';

function setup(passwords: any = { available: () => true, randomGuestHash: async () => ({ hash: 'h', pepperVersion: 1 }) }) {
  const db = createFakeDb([CUSTOMER, ORDER, CREDIT], {
    [ORDER]: { customer: [CUSTOMER, 'customer', 'manyToOne'] },
    [CREDIT]: { customer: [CUSTOMER, 'customer', 'manyToOne'] },
  });
  const log = { warn: vi.fn(), info: vi.fn() };
  const strapi: any = {
    log,
    db: { query: db.query },
    config: {
      get: () => ({ uuid: { modules: { ecommerce: { customer: CUSTOMER, order: ORDER, storeCredit: CREDIT } } } }),
    },
    plugin: () => ({ service: () => passwords }),
  };
  return { db, strapi, log };
}

describe('migrateCustomerAccounts', () => {
  it('normalizes accounts and re-links duplicates to the oldest id, idempotently', async () => {
    const { db, strapi, log } = setup();
    const c = (email: string) => db.query(CUSTOMER).create({ data: { email, emailNormalized: email.toLowerCase() } });
    const a = await c('a@x.pt');
    const b = await c('B@x.pt');
    const b2 = await c('b@x.pt');
    await db.query(ORDER).create({ data: { customer: a.id } });
    await db.query(ORDER).create({ data: { customer: b.id } });
    await db.query(ORDER).create({ data: { customer: b2.id } });
    await db.query(CREDIT).create({ data: { customer: b2.id } });

    expect(await migrateCustomerAccounts(strapi)).toEqual({ normalized: 3, relinked: 2 });
    for (const row of db.tables[CUSTOMER]) {
      expect(row).toMatchObject({ accountType: 'GUEST', emailVerified: false, blocked: false });
    }
    expect(db.tables[ORDER].map((o) => o.customer)).toEqual([a.id, b.id, b.id]);
    expect(db.tables[CREDIT][0].customer).toBe(b.id);
    expect(db.tables[CUSTOMER]).toHaveLength(3);

    expect(await migrateCustomerAccounts(strapi)).toEqual({ normalized: 0, relinked: 0 });
    expect(JSON.stringify(Object.values(log).map((fn: any) => fn.mock?.calls ?? []))).not.toContain('@');
  });

  it('keeps existing account types', async () => {
    const { db, strapi } = setup();
    await db.query(CUSTOMER).create({ data: { emailNormalized: 'r@x.pt', accountType: 'REGISTERED', blocked: true } });
    expect(await migrateCustomerAccounts(strapi)).toEqual({ normalized: 0, relinked: 0 });
    expect(db.tables[CUSTOMER][0]).toMatchObject({ accountType: 'REGISTERED', blocked: true });
  });
});

describe('fillGuestHashes', () => {
  it('fills missing hashes on guests only, in batches', async () => {
    const { db, strapi } = setup();
    for (let i = 0; i < 5; i++) await db.query(CUSTOMER).create({ data: { emailNormalized: `g${i}`, accountType: 'GUEST' } });
    await db.query(CUSTOMER).create({ data: { emailNormalized: 'r', accountType: 'REGISTERED' } });
    await db.query(CUSTOMER).create({ data: { emailNormalized: 'h', accountType: 'GUEST', passwordHash: 'keep' } });

    expect(await fillGuestHashes(strapi, { batch: 2 })).toBe(5);
    const rows = db.tables[CUSTOMER];
    expect(rows.slice(0, 5).every((r) => r.passwordHash === 'h' && r.passwordPepperVersion === 1)).toBe(true);
    expect(rows[5].passwordHash).toBeUndefined();
    expect(rows[6].passwordHash).toBe('keep');
    expect(await fillGuestHashes(strapi)).toBe(0);
  });

  it('does nothing when the service is unavailable, and never throws', async () => {
    const { db, strapi } = setup({ available: () => false, randomGuestHash: vi.fn() });
    await db.query(CUSTOMER).create({ data: { emailNormalized: 'g', accountType: 'GUEST' } });
    expect(await fillGuestHashes(strapi)).toBe(0);

    const s2 = setup({ available: () => true, randomGuestHash: async () => { throw new Error('boom'); } });
    await s2.db.query(CUSTOMER).create({ data: { emailNormalized: 'g', accountType: 'GUEST' } });
    expect(await fillGuestHashes(s2.strapi)).toBe(0);
    expect(s2.log.warn).toHaveBeenCalled();
  });

  it('leaves a row that a concurrent register filled between the fetch and the update', async () => {
    let db: any;
    const passwords = {
      available: () => true,
      randomGuestHash: async () => {
        // A registration lands while the guest hash is being computed.
        Object.assign(db.tables[CUSTOMER][0], { accountType: 'REGISTERED', passwordHash: 'REAL', passwordPepperVersion: 2 });
        return { hash: 'h', pepperVersion: 1 };
      },
    };
    const s = setup(passwords);
    db = s.db;
    await db.query(CUSTOMER).create({ data: { emailNormalized: 'g', accountType: 'GUEST' } });
    expect(await fillGuestHashes(s.strapi)).toBe(0);
    expect(db.tables[CUSTOMER][0]).toMatchObject({ accountType: 'REGISTERED', passwordHash: 'REAL', passwordPepperVersion: 2 });
  });
});
