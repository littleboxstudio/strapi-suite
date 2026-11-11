import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// JSON.parse keeps the last of two equal keys, so a duplicated attribute would go unnoticed by
// the other content-type tests. This scanner walks the raw text and reports every object key
// that appears twice in the same object (path, key).
const DIR = join(__dirname, '../../../server/src/content-types/modules/ecommerce');

const duplicateKeys = (text: string): string[] => {
  const found: string[] = [];
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const start = i;
    i++; // opening quote
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = (path: string): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const seen = new Set<string>();
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        const key = str();
        if (seen.has(key)) found.push(`${path}.${key}`);
        seen.add(key);
        ws();
        i++; // colon
        value(`${path}.${key}`);
        ws();
        if (text[i++] === '}') return;
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        value(`${path}[${n}]`);
        ws();
        if (text[i++] === ']') return;
      }
    }
    if (c === '"') {
      str();
      return;
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  };
  value('$');
  return found;
};

describe('ecommerce schema.json files', () => {
  it('the scanner detects a duplicated key (nested)', () => {
    expect(duplicateKeys('{"a":{"b":1,"c":[{"x":"}"}],"b":2},"d":true}')).toEqual(['$.a.b']);
    expect(duplicateKeys('{"a":1,"b":{"a":2}}')).toEqual([]);
  });

  for (const dir of readdirSync(DIR)) {
    it(`${dir} has no duplicated keys`, () => {
      const text = readFileSync(join(DIR, dir, 'schema.json'), 'utf8');
      expect(duplicateKeys(text)).toEqual([]);
    });
  }
});
