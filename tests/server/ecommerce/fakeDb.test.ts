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

describe('fakeDb many-to-many', () => {
  const PRODUCT = 'product';
  const TAG = 'tag';
  const setup = () =>
    createFakeDb([PRODUCT, TAG], {
      [PRODUCT]: { tags: [TAG, 'products_tags', 'manyToMany'] },
      [TAG]: { products: [PRODUCT, 'products_tags', 'manyToMany'] },
    });

  it('connects on create and filters by a nested where, from both sides', async () => {
    const db = setup();
    for (const key of ['a', 'b', 'c']) await db.query(TAG).create({ data: { key } });
    const p1 = await db.query(PRODUCT).create({ data: { name: 'p1', tags: { connect: [1, 2] } } });
    await db.query(PRODUCT).create({ data: { name: 'p2', tags: { connect: [{ id: 3 }] } } });
    expect(p1).not.toHaveProperty('tags');
    const found = await db.query(PRODUCT).findMany({ where: { tags: { id: 2 } } });
    expect(found.map((r: any) => r.name)).toEqual(['p1']);
    expect(await db.query(PRODUCT).count({ where: { tags: { key: 'c' } } })).toBe(1);
    const tagsOf1 = await db.query(TAG).findMany({ where: { products: { name: 'p1' } } });
    expect(tagsOf1.map((r: any) => r.key)).toEqual(['a', 'b']);
  });

  it('set replaces, connect adds, disconnect removes', async () => {
    const db = setup();
    for (const key of ['a', 'b', 'c']) await db.query(TAG).create({ data: { key } });
    await db.query(PRODUCT).create({ data: { name: 'p1', tags: { connect: [1, 2] } } });
    await db.query(PRODUCT).update({ where: { id: 1 }, data: { tags: { set: [3] } } });
    let p: any = await db.query(PRODUCT).findOne({ where: { id: 1 }, populate: { tags: true } });
    expect(p.tags.map((t: any) => t.id)).toEqual([3]);
    await db.query(PRODUCT).update({ where: { id: 1 }, data: { tags: { connect: [1, 2], disconnect: [3] } } });
    p = await db.query(PRODUCT).findOne({ where: { id: 1 }, populate: { tags: true } });
    expect(p.tags.map((t: any) => t.id)).toEqual([1, 2]);
    expect(await db.query(PRODUCT).findMany({ where: { tags: { id: 3 } } })).toEqual([]);
  });

  it('populates tag rows and the reverse side; delete drops links; rolls back', async () => {
    const db = setup();
    await db.query(TAG).create({ data: { key: 'a' } });
    await db.query(PRODUCT).create({ data: { name: 'p1', tags: { connect: [1] } } });
    const t: any = await db.query(TAG).findOne({ where: { id: 1 }, populate: { products: true } });
    expect(t.products.map((r: any) => r.name)).toEqual(['p1']);
    await expect(
      db.transaction(async () => {
        await db.query(PRODUCT).update({ where: { id: 1 }, data: { tags: { set: [] } } });
        throw new Error('x');
      })
    ).rejects.toThrow('x');
    expect(await db.query(PRODUCT).count({ where: { tags: { id: 1 } } })).toBe(1);
    await db.query(PRODUCT).delete({ where: { id: 1 } });
    expect(await db.query(TAG).findMany({ where: { products: { id: 1 } } })).toEqual([]);
  });
});
