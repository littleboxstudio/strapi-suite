import { describe, it, expect } from 'vitest';
import { mergeTranslations } from '../../../admin/src/core/utils/mergeTranslations';

describe('mergeTranslations', () => {
  it('overrides base keys with locale keys and keeps the rest', () => {
    expect(mergeTranslations({ a: 'A', b: 'B' }, { a: 'Á' })).toEqual({ a: 'Á', b: 'B' });
  });
});
