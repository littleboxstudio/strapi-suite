import { describe, it, expect } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';
import { migrateOrderEditingData } from '../../../server/src/services/modules/ecommerce/orderEditingMigration';
import { legacyEditingData } from '../../../server/src/services/modules/ecommerce/domain/orderEditingData';

const ORDER = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-order';
const KEYS = ['shippingLines', 'manualDiscounts', 'reviewFlags'];

const legacyOrder = (over: Record<string, unknown> = {}) => ({
  reference: 1001,
  createdAt: '2026-01-02T10:00:00.000Z',
  orderDiscount: 0,
  promotions: { applied: [], codes: [], exhaustive: true },
  shippingOriginal: 500,
  shippingTax: 23,
  shippingMethod: { providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, tax: 23 },
  notes: 'keep me',
  total: 7000,
  ...over,
});

function setup() {
  const db = createFakeDb([ORDER], {});
  const strapi: any = {
    db: { query: db.query },
    config: { get: () => ({ uuid: { modules: { ecommerce: { order: ORDER } } } }) },
  };
  return { db, strapi, rows: () => db.tables[ORDER] };
}

const strip = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !KEYS.includes(k)));

describe('migrateOrderEditingData', () => {
  it('backfills legacy orders without touching other columns, then is idempotent', async () => {
    const { db, strapi, rows } = setup();
    await db.query(ORDER).create({ data: legacyOrder() });
    await db.query(ORDER).create({
      data: legacyOrder({
        reference: 1002,
        orderDiscount: 700,
        promotions: { applied: [{ benefits: [{ class: 'ORDER_DISCOUNT', amount: 500 }] }], codes: [], exhaustive: true },
      }),
    });
    const before = rows().map((r: any) => strip(r));

    expect(await migrateOrderEditingData(strapi)).toEqual({ migrated: 2 });

    const after = rows();
    expect(after.map(strip)).toEqual(before);
    for (const r of after) {
      expect(r.shippingLines.lines).toHaveLength(1);
      expect(r.shippingLines.lines[0]).toMatchObject({ origin: 'CHECKOUT', amount: 500 });
      expect(r.reviewFlags).toEqual({ flags: [] });
    }
    expect(after[0].manualDiscounts).toEqual({ items: [] });
    expect(after[1].manualDiscounts.items).toEqual([
      expect.objectContaining({ kind: 'LEGACY', amount: 200 }),
    ]);

    expect(await migrateOrderEditingData(strapi)).toEqual({ migrated: 0 });
  });

  it('walks every batch', async () => {
    const { db, strapi, rows } = setup();
    for (let i = 0; i < 3; i++) await db.query(ORDER).create({ data: legacyOrder({ reference: 1001 + i }) });
    expect(await migrateOrderEditingData(strapi, 1)).toEqual({ migrated: 3 });
    expect(rows().every((r: any) => r.shippingLines !== null)).toBe(true);
  });

  it('legacyEditingData wraps the readers in objects', () => {
    const d = legacyEditingData(legacyOrder());
    expect(d.manualDiscounts).toEqual({ items: [] });
    expect(d.reviewFlags).toEqual({ flags: [] });
    expect(d.shippingLines.lines[0].origin).toBe('CHECKOUT');
  });
});
