import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

const CONTENT_TYPES_DIR = join(__dirname, '../../../../server/src/content-types/modules/ecommerce');

/** uid -> names of attributes matching `pick`, read from the plugin's ecommerce schemas. */
function loadAttributes(pick: (a: any) => boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dir of readdirSync(CONTENT_TYPES_DIR)) {
    let schema: any;
    try {
      schema = JSON.parse(readFileSync(join(CONTENT_TYPES_DIR, dir, 'schema.json'), 'utf8'));
    } catch {
      continue;
    }
    out[`plugin::littlebox-strapi-suite.${schema.info.singularName}`] = Object.entries(
      schema.attributes ?? {}
    )
      .filter(([, a]: [string, any]) => pick(a))
      .map(([name]) => name);
  }
  return out;
}

const JSON_ATTRIBUTES = loadAttributes((a) => a.type === 'json');
const UNIQUE_ATTRIBUTES = loadAttributes((a) => a.unique === true);

/** Mirrors a database unique index: inserting a duplicate value fails. */
function assertUnique(uid: string, rows: any[], data: any, selfId?: number): void {
  for (const attr of UNIQUE_ATTRIBUTES[uid] ?? []) {
    const v = data?.[attr];
    if (v === null || v === undefined) continue;
    if (rows.some((r) => r.id !== selfId && r[attr] === v)) {
      throw Object.assign(new Error(`UNIQUE constraint failed: ${uid}.${attr}`), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
      });
    }
  }
}

/**
 * MariaDB/MySQL json columns carry CHECK(json_valid(col)) and Strapi passes strings through
 * unencoded, so only objects, arrays and null are safe. Mirror that strictly.
 */
function assertJsonColumns(uid: string, data: any): void {
  for (const attr of JSON_ATTRIBUTES[uid] ?? []) {
    if (!data || !(attr in data)) continue;
    const v = data[attr];
    if (v === null || v === undefined || typeof v === 'object') continue;
    throw new Error(`CONSTRAINT ${uid}.${attr} failed: json column needs an object, array or null`);
  }
}

/**
 * relation name -> [target uid, foreign key on target] (oneToMany), or
 * [target uid, column on this row holding the target id, 'manyToOne'].
 */
export type FakeRelations = Record<
  string,
  Record<string, [string, string] | [string, string, 'manyToOne']>
>;

/**
 * In-memory stand-in for the Strapi Query Engine (`strapi.db`), covering the subset the
 * e-commerce services use. `transaction` restores every table when the callback throws.
 * `metadata.get(uid).tableName` is the uid itself, so `connection(tableName)` (a tiny knex-like
 * builder: `.where({ id }).increment(col, n).transacting(trx)`) reaches the same rows.
 */
export function createFakeDb(
  uids: string[],
  relations: FakeRelations = {},
  options: { enforceUnique?: string[] } = {}
) {
  const enforced = new Set(options.enforceUnique ?? []);
  const checkUnique = (uid: string, data: any, selfId?: number) => {
    if (enforced.has(uid)) assertUnique(uid, tables[uid], data, selfId);
  };
  const tables: Record<string, any[]> = Object.fromEntries(uids.map((u) => [u, []]));
  const seq: Record<string, number> = {};
  const isOp = (o: any) =>
    o && typeof o === 'object' && Object.keys(o).some((k) => k.startsWith('$'));

  const match = (uid: string, row: any, where: any = {}): boolean =>
    Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === '$or') return cond.some((w: any) => match(uid, row, w));
      const rel = relations[uid]?.[key];
      if (rel) {
        if (rel[2] === 'manyToOne') {
          return tables[rel[0]].some((r) => r.id === row[rel[1]] && match(rel[0], r, cond));
        }
        return tables[rel[0]].some((r) => r[rel[1]] === row.id && match(rel[0], r, cond));
      }
      const value = key === 'id' ? row.id : row[key];
      if (isOp(cond)) {
        if ('$in' in cond) return cond.$in.includes(value);
        if ('$ne' in cond) return value !== cond.$ne;
        if ('$containsi' in cond)
          return String(value ?? '')
            .toLowerCase()
            .includes(cond.$containsi.toLowerCase());
        throw new Error('unsupported op');
      }
      if (cond && typeof cond === 'object') return match(uid, { id: value }, cond);
      return value === cond;
    });

  const populate = (uid: string, row: any, pop: any): any => {
    if (!pop) return { ...row };
    const out = { ...row };
    for (const [key, spec] of Object.entries(pop) as [string, any][]) {
      const [target, fk, kind] = relations[uid][key];
      const nested = spec === true ? null : spec.populate;
      if (kind === 'manyToOne') {
        const r = tables[target].find((x) => x.id === row[fk]);
        out[key] = r ? populate(target, r, nested) : null;
        continue;
      }
      out[key] = tables[target]
        .filter((r) => r[fk] === row.id)
        .map((r) => populate(target, r, spec === true ? null : spec.populate));
    }
    return out;
  };

  const sort = (rows: any[], orderBy: any): any[] => {
    if (!orderBy) return rows;
    const specs: [string, string][] = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap(
      (o: any) => Object.entries(o) as [string, string][]
    );
    return [...rows].sort((a, b) => {
      for (const [field, dir] of specs) {
        const av = a[field] ?? 0;
        const bv = b[field] ?? 0;
        if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };

  const query = (uid: string) => ({
    findMany: async (p: any = {}) => {
      let rows = sort(
        tables[uid].filter((r) => match(uid, r, p.where)),
        p.orderBy
      );
      if (p.offset !== undefined) rows = rows.slice(p.offset, p.offset + (p.limit ?? rows.length));
      return rows.map((r) => populate(uid, r, p.populate));
    },
    findOne: async (p: any = {}) => {
      const r = tables[uid].find((x) => match(uid, x, p.where));
      return r ? populate(uid, r, p.populate) : null;
    },
    count: async (p: any = {}) => tables[uid].filter((r) => match(uid, r, p.where)).length,
    create: async ({ data }: any) => {
      assertJsonColumns(uid, data);
      checkUnique(uid, data);
      seq[uid] = (seq[uid] ?? 0) + 1;
      const row = { id: seq[uid], ...data };
      tables[uid].push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      assertJsonColumns(uid, data);
      const r = tables[uid].find((x) => match(uid, x, where));
      if (!r) return null;
      checkUnique(uid, data, r.id);
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({ where, data }: any) => {
      assertJsonColumns(uid, data);
      const rows = tables[uid].filter((x) => match(uid, x, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    delete: async ({ where }: any) => {
      const i = tables[uid].findIndex((x) => match(uid, x, where));
      if (i >= 0) tables[uid].splice(i, 1);
    },
    deleteMany: async ({ where }: any) => {
      tables[uid] = tables[uid].filter((x) => !match(uid, x, where));
    },
  });

  /** The trx handed to transaction callbacks; `connection` calls record what they ran with. */
  const trx = { fakeTrx: true };
  const increments: { table: string; where: any; column: string; amount: number; trx: any }[] = [];

  const connection = (table: string) => {
    if (!tables[table]) throw new Error(`unknown table ${table}`);
    const state: { where: any; column?: string; amount?: number; trx?: any } = { where: {} };
    const run = () => {
      if (state.column === undefined) throw new Error('only increment is supported');
      const rows = tables[table].filter((r) => match(table, r, state.where));
      rows.forEach((r) => {
        r[state.column as string] = (r[state.column as string] ?? 0) + (state.amount as number);
      });
      increments.push({
        table,
        where: state.where,
        column: state.column,
        amount: state.amount as number,
        trx: state.trx,
      });
      return rows.length;
    };
    const builder: any = {
      where(w: any) {
        state.where = { ...state.where, ...w };
        return builder;
      },
      increment(column: string, amount: number) {
        state.column = column;
        state.amount = amount;
        return builder;
      },
      transacting(t: any) {
        state.trx = t;
        return builder;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return builder;
  };

  const metadata = { get: (uid: string) => ({ tableName: uid }) };

  const transaction = vi.fn(async (cb: (ctx: { trx: any }) => Promise<any>) => {
    const snapshot = JSON.stringify(tables);
    try {
      return await cb({ trx });
    } catch (e) {
      const restored = JSON.parse(snapshot);
      for (const k of Object.keys(tables)) tables[k] = restored[k];
      throw e;
    }
  });

  return { tables, query, transaction, connection, metadata, trx, increments };
}
