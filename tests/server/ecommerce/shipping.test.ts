import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceShippingService, {
  __resetCarrierQuotersForTests,
} from '../../../server/src/services/modules/ecommerce/shipping';

const method = (id: number, price: number, countries: string[], extra = {}) => ({
  id, name: { pt: `M${id}`, en: `M${id}en` }, price, tax: 23, countries, active: true, position: id, ...extra,
});

function setup(opts: { carriers?: string[]; methods?: any[]; countries?: string[] } = {}) {
  const settings = {
    listManualMethods: async () => opts.methods ?? [],
    getStoreSettings: async () => ({ shippingCountries: opts.countries ?? ['PT', 'ES'] }),
    getActiveProviders: async () => opts.carriers ?? ['manual'],
    getRuntime: async () => ({ config: {}, secrets: {}, active: true }),
  };
  const warn = vi.fn();
  const strapi: any = {
    log: { warn },
    plugin: (id: string) =>
      id === 'i18n' ? { service: () => ({ getDefaultLocale: async () => 'pt' }) } : { service: () => settings },
  };
  return EcommerceShippingService({ strapi });
}

const req = (country = 'PT') => ({ country, items: [], subtotal: 1000, locale: 'en' });

beforeEach(() => __resetCarrierQuotersForTests());

describe('EcommerceShippingService', () => {
  it('filters manual methods by country and store countries', async () => {
    const s = setup({ methods: [method(1, 500, ['PT']), method(2, 300, ['ES']), method(3, 100, ['PT'], { active: false })] });
    const { options } = await s.quote(req('PT'));
    expect(options.map((o) => o.serviceId)).toEqual(['1']);
    expect(options[0]).toMatchObject({ providerId: 'manual', name: 'M1en', price: 500, tax: 23 });
    expect((await s.quote(req('FR'))).options).toEqual([]);
  });

  it('falls back to the default locale and ignores manual when inactive', async () => {
    const s = setup({ methods: [method(1, 1, ['PT'], { name: { pt: 'Só PT' } })] });
    expect((await s.quote(req())).options[0].name).toBe('Só PT');
    const off = setup({ carriers: [], methods: [method(1, 1, ['PT'])] });
    expect((await off.quote(req())).options).toEqual([]);
  });

  it('a failing carrier does not hide manual methods', async () => {
    const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, 500, ['PT'])] });
    s.registerCarrierQuoter('ctt', async () => {
      throw Object.assign(new Error('x'), { code: 'UNREACHABLE' });
    });
    const r = await s.quote(req());
    expect(r.options).toHaveLength(1);
    expect(r.failures).toEqual([{ providerId: 'ctt', code: 'UNREACHABLE' }]);
  });

  it('merges carrier options and sorts by price then name', async () => {
    const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, 500, ['PT']), method(2, 500, ['PT'], { name: { pt: 'A', en: 'A' } })] });
    s.registerCarrierQuoter('ctt', async () => [{ providerId: 'ctt', serviceId: 'e', name: 'Exp', price: 300, tax: 23 }]);
    const { options } = await s.quote(req());
    expect(options.map((o) => `${o.providerId}:${o.serviceId}`)).toEqual(['ctt:e', 'manual:2', 'manual:1']);
  });

  it('findOption returns the option or null', async () => {
    const s = setup({ methods: [method(1, 500, ['PT'])] });
    expect(await s.findOption(req(), 'manual', '1')).toMatchObject({ price: 500 });
    expect(await s.findOption(req(), 'manual', '99')).toBeNull();
  });
});
