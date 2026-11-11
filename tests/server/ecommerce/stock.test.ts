import { describe, it, expect, vi } from 'vitest';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import { createFakeDb } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = { variant: `${P}variant`, stockMovement: `${P}stock-movement` };

type Db = ReturnType<typeof createFakeDb>;

function makeStrapi(override: (db: Db) => Partial<Db> = () => ({})) {
  const db = createFakeDb(Object.values(UIDS), {}, { enforceUnique: [UIDS.stockMovement] });
  const o = override(db);
  const strapi: any = {
    db: {
      query: o.query ?? db.query,
      transaction: db.transaction,
      connection: o.connection ?? db.connection,
      metadata: db.metadata,
    },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    log: { warn: vi.fn() },
  };
  db.tables[UIDS.variant].push({ id: 1, sku: 'A', stock: 3 }, { id: 2, sku: 'B', stock: 10 });
  return { service: EcommerceStockService({ strapi }), strapi, ...db };
}

const stockOf = (tables: Record<string, any[]>, id: number) =>
  tables[UIDS.variant].find((v) => v.id === id).stock;

describe('EcommerceStockService', () => {
  it('applies the same operationKey only once', async () => {
    const { service, tables } = makeStrapi();
    const input = {
      variantId: 1,
      quantity: -2,
      type: 'ORDER_DEDUCT' as const,
      operationKey: 'order:7:deduct:1',
      orderId: 7,
      actor: 'system',
    };
    expect(await service.move(input)).toEqual({ applied: true });
    expect(await service.move(input)).toEqual({ applied: false });
    expect(stockOf(tables, 1)).toBe(1);
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
    expect(tables[UIDS.stockMovement][0]).toMatchObject({
      variant: 1,
      variantId: 1,
      order: 7,
      type: 'ORDER_DEDUCT',
      quantity: -2,
      operationKey: 'order:7:deduct:1',
      actor: 'system',
    });
  });

  it('treats a unique-constraint failure on insert as already applied', async () => {
    // Another request inserts the same key between the lookup and the insert.
    const { service, tables } = makeStrapi((db) => ({
      query: ((uid: string) => {
        const q = db.query(uid);
        return uid === UIDS.stockMovement ? { ...q, findOne: async () => null } : q;
      }) as Db['query'],
    }));
    tables[UIDS.stockMovement].push({ id: 99, operationKey: 'race', variantId: 1, quantity: 5 });
    expect(
      await service.move({
        variantId: 1,
        quantity: 5,
        type: 'MANUAL_ADJUST',
        operationKey: 'race',
        actor: 'user:1',
      })
    ).toEqual({ applied: false });
    expect(stockOf(tables, 1)).toBe(3);
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
  });

  it('lets a negative increment take stock below zero without error', async () => {
    const { service, tables, increments, trx } = makeStrapi();
    await service.move({
      variantId: 1,
      quantity: -5,
      type: 'ORDER_DEDUCT',
      operationKey: 'k1',
      orderId: 1,
      actor: 'system',
    });
    expect(stockOf(tables, 1)).toBe(-2);
    expect(increments).toEqual([
      { table: UIDS.variant, where: { id: 1 }, column: 'stock', amount: -5, trx },
    ]);
  });

  it('runs the increment on the transaction trx', async () => {
    const { service, increments, trx, transaction } = makeStrapi();
    await service.move({
      variantId: 2,
      quantity: 1,
      type: 'MANUAL_ADJUST',
      operationKey: 'k',
      actor: 'system',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(increments[0].trx).toBe(trx);
  });

  it('rethrows constraint errors that are not unique violations', async () => {
    const fk = Object.assign(new Error('FOREIGN KEY constraint failed'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    });
    const { service } = makeStrapi((db) => ({
      query: ((uid: string) => {
        const q = db.query(uid);
        return uid === UIDS.stockMovement
          ? { ...q, create: async () => Promise.reject(fk) }
          : q;
      }) as Db['query'],
    }));
    await expect(
      service.move({
        variantId: 1,
        quantity: 1,
        type: 'MANUAL_ADJUST',
        operationKey: 'fk',
        actor: 'system',
      })
    ).rejects.toBe(fk);
  });

  it.each([
    { code: '23505' },
    { code: 'ER_DUP_ENTRY' },
    { errno: 1062 },
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' },
  ])('treats %o as already applied', async (props) => {
    const dup = Object.assign(new Error('boom'), props);
    const { service } = makeStrapi((db) => ({
      query: ((uid: string) => {
        const q = db.query(uid);
        return uid === UIDS.stockMovement
          ? { ...q, create: async () => Promise.reject(dup) }
          : q;
      }) as Db['query'],
    }));
    expect(
      await service.move({
        variantId: 1,
        quantity: 1,
        type: 'MANUAL_ADJUST',
        operationKey: 'dup',
        actor: 'system',
      })
    ).toEqual({ applied: false });
  });

  it('records the movement without a variant relation and skips the increment when the variant is gone', async () => {
    const { service, tables, increments, strapi } = makeStrapi();
    expect(
      await service.move({
        variantId: 404,
        quantity: 2,
        type: 'CANCEL_RESTOCK',
        operationKey: 'cancel:7:404',
        orderId: 7,
        actor: 'system',
      })
    ).toEqual({ applied: true });
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
    expect(tables[UIDS.stockMovement][0]).toMatchObject({
      variant: null,
      variantId: 404,
      order: 7,
      type: 'CANCEL_RESTOCK',
      quantity: 2,
    });
    expect(increments).toEqual([]);
    expect(stockOf(tables, 1)).toBe(3);
    expect(stockOf(tables, 2)).toBe(10);
    expect(strapi.log.warn).toHaveBeenCalledTimes(1);
    expect(String(strapi.log.warn.mock.calls[0][0])).toContain('404');
  });

  it('does not throw when the increment updates no row (variant deleted concurrently)', async () => {
    const { service, tables, strapi } = makeStrapi((db) => ({
      connection: ((table: string) => {
        const b = db.connection(table);
        return { ...b, where: () => ({ increment: () => ({ transacting: async () => 0 }) }) };
      }) as any,
    }));
    expect(
      await service.move({
        variantId: 1,
        quantity: 1,
        type: 'MANUAL_ADJUST',
        operationKey: 'gone',
        actor: 'system',
      })
    ).toEqual({ applied: true });
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  it('records RETURN_NO_RESTOCK without touching stock', async () => {
    const { service, tables, increments } = makeStrapi();
    expect(
      await service.move({
        variantId: 2,
        quantity: 2,
        type: 'RETURN_NO_RESTOCK',
        operationKey: 'ret:1',
        orderId: 4,
        reason: 'damaged',
        actor: 'user:3',
      })
    ).toEqual({ applied: true });
    expect(stockOf(tables, 2)).toBe(10);
    expect(increments).toEqual([]);
    expect(tables[UIDS.stockMovement][0]).toMatchObject({
      type: 'RETURN_NO_RESTOCK',
      quantity: 2,
      reason: 'damaged',
    });
  });

  it('rolls back the movement when the increment fails', async () => {
    const { service, tables } = makeStrapi(() => ({
      connection: (() => ({
        where: () => ({
          increment: () => ({
            transacting: () => Promise.reject(new Error('db down')),
          }),
        }),
      })) as any,
    }));
    await expect(
      service.move({
        variantId: 1,
        quantity: 1,
        type: 'MANUAL_ADJUST',
        operationKey: 'x',
        actor: 'system',
      })
    ).rejects.toThrow('db down');
    expect(tables[UIDS.stockMovement]).toHaveLength(0);
  });

  it('netDeductedForOrder sums deductions and restocks, ignoring RETURN_NO_RESTOCK', async () => {
    const { service } = makeStrapi();
    const base = { orderId: 9, actor: 'system' };
    await service.move({ ...base, variantId: 1, quantity: -3, type: 'ORDER_DEDUCT', operationKey: 'a' });
    await service.move({ ...base, variantId: 2, quantity: -2, type: 'ORDER_DEDUCT', operationKey: 'b' });
    await service.move({ ...base, variantId: 1, quantity: 1, type: 'ORDER_RESTOCK', operationKey: 'c' });
    await service.move({ ...base, variantId: 2, quantity: 1, type: 'RETURN_NO_RESTOCK', operationKey: 'd' });
    await service.move({ ...base, variantId: 2, quantity: 1, type: 'RETURN_RESTOCK', operationKey: 'e' });
    // Another order and a manual adjustment do not count.
    await service.move({ ...base, orderId: 10, variantId: 1, quantity: -4, type: 'ORDER_DEDUCT', operationKey: 'f' });
    await service.move({ variantId: 1, quantity: 7, type: 'MANUAL_ADJUST', operationKey: 'g', actor: 'user:1' });

    const net = await service.netDeductedForOrder(9);
    expect([...net.entries()].sort()).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('available returns current stock per variant', async () => {
    const { service, tables } = makeStrapi();
    tables[UIDS.variant][0].stock = -1;
    const map = await service.available([1, 2, 404]);
    expect(map.get(1)).toBe(-1);
    expect(map.get(2)).toBe(10);
    expect(map.has(404)).toBe(false);
    expect((await service.available([])).size).toBe(0);
  });
});
