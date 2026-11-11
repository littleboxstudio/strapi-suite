import { describe, it, expect } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';

describe('fakeDb range operators', () => {
  const setup = async () => {
    const db = createFakeDb(['t']);
    for (const n of [1, 2, 3, 4, 5, null]) await db.query('t').create({ data: { n } });
    const ns = async (where: any) => (await db.query('t').findMany({ where })).map((r: any) => r.n);
    return ns;
  };

  it('applies every operator of a condition (AND), as a database does', async () => {
    const ns = await setup();
    expect(await ns({ n: { $gte: 2, $lt: 4 } })).toEqual([2, 3]);
    expect(await ns({ n: { $gt: 1, $lte: 3 } })).toEqual([2, 3]);
    expect(await ns({ n: { $gte: 4, $lt: 2 } })).toEqual([]);
  });

  it('never matches NULL and compares dates by instant', async () => {
    const ns = await setup();
    expect(await ns({ n: { $lt: 100 } })).toEqual([1, 2, 3, 4, 5]);
    const db = createFakeDb(['d']);
    await db.query('d').create({ data: { at: new Date('2026-01-02T00:00:00.000Z') } });
    await db.query('d').create({ data: { at: '2026-01-04T00:00:00.000Z' } });
    const found = await db.query('d').findMany({
      where: { at: { $gt: '2026-01-01T00:00:00.000Z', $lt: new Date('2026-01-03T00:00:00.000Z') } },
    });
    expect(found).toHaveLength(1);
  });

  it('deleteMany and updateMany report the rows they changed', async () => {
    const db = createFakeDb(['t']);
    for (const n of [1, 2, 3]) await db.query('t').create({ data: { n } });
    expect(await db.query('t').updateMany({ where: { n: { $gte: 2 } }, data: { m: 1 } })).toEqual({
      count: 2,
    });
    expect(await db.query('t').deleteMany({ where: { n: { $lt: 3 } } })).toEqual({ count: 2 });
  });
});
