import { describe, it, expect } from 'vitest';
import { resolveLocale } from '../../../server/src/services/modules/ecommerce/locales';

const strapiWith = (codes: string[], defaultLocale = 'en'): any => ({
  plugin: (id: string) => {
    if (id !== 'i18n') throw new Error(`unexpected plugin ${id}`);
    return {
      service: () => ({
        getDefaultLocale: async () => defaultLocale,
        find: async () => codes.map((code) => ({ code, name: code })),
      }),
    };
  },
});

describe('resolveLocale', () => {
  it('returns an existing locale', async () => {
    expect(await resolveLocale(strapiWith(['en', 'pt']), 'pt')).toBe('pt');
  });

  it('matches case-insensitively and returns the stored case', async () => {
    expect(await resolveLocale(strapiWith(['en', 'pt-PT']), ' PT-pt ')).toBe('pt-PT');
  });

  it('returns the default locale for an unknown, empty or non-string code', async () => {
    const strapi = strapiWith(['en', 'pt'], 'pt');
    expect(await resolveLocale(strapi, 'xx')).toBe('pt');
    expect(await resolveLocale(strapi, '')).toBe('pt');
    expect(await resolveLocale(strapi, undefined)).toBe('pt');
    expect(await resolveLocale(strapi, 42)).toBe('pt');
  });
});
