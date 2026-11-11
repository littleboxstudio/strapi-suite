import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

describe('server/src bundle hygiene', () => {
  it('never imports @strapi/utils (it is not a declared dependency and would be inlined)', () => {
    const root = path.resolve(__dirname, '../../../server/src');
    const offenders = walk(root).filter((f) => {
      const c = fs.readFileSync(f, 'utf8');
      return c.includes("from '@strapi/utils'") || c.includes("require('@strapi/utils')");
    });
    expect(offenders).toEqual([]);
  });
});
