import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Strapi 5 does not create database unique indexes from attribute-level `unique: true`;
// only schema-level `indexes` with `type: 'unique'` reach the database.
const DIR = join(__dirname, '../../../server/src/content-types/modules/ecommerce');
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const schemas = readdirSync(DIR).map((d) => ({
  dir: d,
  schema: JSON.parse(readFileSync(join(DIR, d, 'schema.json'), 'utf8')),
}));

describe('ecommerce schema unique indexes', () => {
  for (const { dir, schema } of schemas) {
    const uniques = Object.entries(schema.attributes ?? {})
      .filter(([, a]: [string, any]) => a.unique === true)
      .map(([name]) => name);
    for (const attr of uniques) {
      it(`${dir}.${attr} has a real unique index`, () => {
        const idx = (schema.indexes ?? []).find(
          (i: any) => i.type === 'unique' && i.columns.length === 1 && i.columns[0] === snake(attr)
        );
        expect(idx, `${dir}.${attr}`).toBeDefined();
      });
    }
  }

  it('index names are unique across the plugin and at most 60 characters', () => {
    const names = schemas.flatMap(({ schema }) => (schema.indexes ?? []).map((i: any) => i.name));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(60);
  });
});
