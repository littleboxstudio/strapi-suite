import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceShippingService, {
  __resetCarrierQuotersForTests,
  getCarrierAdapter,
  registerCarrierAdapter,
  registerCarrierQuoter,
} from '../../../server/src/services/modules/ecommerce/shipping';

const method = (id: number, price: number, countries: string[], extra = {}) => ({
  id, name: { pt: `M${id}`, en: `M${id}en` }, price, tax: 23, countries, active: true, position: id, ...extra,
});

let lastWarn: ReturnType<typeof vi.fn>;
function setup(
  opts: { carriers?: string[]; methods?: any[]; countries?: string[]; runtime?: (id: string) => any } = {}
) {
  const settings = {
    listManualMethods: async () => opts.methods ?? [],
    getStoreSettings: async () => ({ shippingCountries: opts.countries ?? ['PT', 'ES'] }),
    getActiveProviders: async () => opts.carriers ?? ['manual'],
    getRuntime: async (id: string) =>
      opts.runtime ? opts.runtime(id) : { config: {}, secrets: {}, active: true },
  };
  const warn = vi.fn();
  lastWarn = warn;
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

  it('hands the adapter an explicit 8 s timeout', async () => {
    const s = setup({ carriers: ['ctt'] });
    const quoter = vi.fn(async () => []);
    s.registerCarrierQuoter('ctt', quoter);
    await s.quote(req());
    expect(quoter).toHaveBeenCalledWith(req(), { config: {}, secrets: {} }, { timeoutMs: 8000 });
  });

  it('findOption returns the option or null', async () => {
    const s = setup({ methods: [method(1, 500, ['PT'])] });
    expect(await s.findOption(req(), 'manual', '1')).toMatchObject({ price: 500 });
    expect(await s.findOption(req(), 'manual', '99')).toBeNull();
  });

  describe('hardened quotes', () => {
    const good = (over = {}) => ({ providerId: 'ctt', serviceId: 'e', name: 'Exp', price: 300, tax: 23, ...over });

    it('times out a never-resolving quoter after 8 s and keeps manual methods', async () => {
      vi.useFakeTimers();
      try {
        const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, 500, ['PT'])] });
        s.registerCarrierQuoter('ctt', () => new Promise(() => undefined));
        const p = s.quote(req());
        await vi.advanceTimersByTimeAsync(8000);
        const r = await p;
        expect(r.failures).toEqual([{ providerId: 'ctt', code: 'TIMEOUT' }]);
        expect(r.options.map((o) => o.providerId)).toEqual(['manual']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('discards invalid options with INVALID_QUOTE and keeps valid ones', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', async () => [
        good({ serviceId: 'ok' }),
        good({ serviceId: 'a', price: 12.5 }),
        good({ serviceId: 'b', price: -1 }),
        good({ serviceId: 'c', name: '' }),
        good({ serviceId: '' }),
        good({ serviceId: 'd', tax: 101 }),
      ]);
      const r = await s.quote(req());
      expect(r.options.map((o) => o.serviceId)).toEqual(['ok']);
      expect(r.failures).toEqual([{ providerId: 'ctt', code: 'INVALID_QUOTE' }]);
    });

    it('non-array result gives INVALID_QUOTE', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', (async () => ({ nope: true })) as any);
      expect(await s.quote(req())).toEqual({ options: [], failures: [{ providerId: 'ctt', code: 'INVALID_QUOTE' }] });
    });

    it('rejects NaN and Infinity prices', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', async () => [good({ price: NaN }), good({ serviceId: 'i', price: Infinity }), good({ serviceId: 'ok' })]);
      const r = await s.quote(req());
      expect(r.options.map((o) => o.serviceId)).toEqual(['ok']);
      expect(r.failures).toEqual([{ providerId: 'ctt', code: 'INVALID_QUOTE' }]);
    });

    it('sanitises adapter error codes', async () => {
      const s = setup({ carriers: ['ctt', 'dpd'] });
      s.registerCarrierQuoter('ctt', async () => { throw Object.assign(new Error('x'), { code: 'bad code https://x' }); });
      s.registerCarrierQuoter('dpd', async () => { throw Object.assign(new Error('x'), { code: 'RATE_LIMITED' }); });
      expect((await s.quote(req())).failures).toEqual([
        { providerId: 'ctt', code: 'QUOTE_FAILED' },
        { providerId: 'dpd', code: 'RATE_LIMITED' },
      ]);
    });

    it('getRuntime is bounded by the timeout and failure order follows carrier order', async () => {
      vi.useFakeTimers();
      try {
        const s = setup({
          carriers: ['a', 'b'],
          runtime: (id) => (id === 'a' ? new Promise(() => undefined) : { config: {}, secrets: {}, active: true }),
        });
        s.registerCarrierQuoter('a', async () => []);
        s.registerCarrierQuoter('b', async () => { throw Object.assign(new Error('x'), { code: 'UNREACHABLE' }); });
        const p = s.quote(req());
        await vi.advanceTimersByTimeAsync(8000);
        expect((await p).failures).toEqual([
          { providerId: 'a', code: 'TIMEOUT' },
          { providerId: 'b', code: 'UNREACHABLE' },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps only known fields and validates estimatedDays', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', async () => [
        good({ serviceId: 'a', estimatedDays: 2, extra: 'x' }),
        good({ serviceId: 'b', estimatedDays: -1 }),
        good({ serviceId: 'c', estimatedDays: 1.5 }),
      ]);
      const r = await s.quote(req());
      expect(r.options).toEqual([{ providerId: 'ctt', serviceId: 'a', name: 'Exp', price: 300, tax: 23, estimatedDays: 2 }]);
      expect(r.failures).toEqual([{ providerId: 'ctt', code: 'INVALID_QUOTE' }]);
    });

    it('forces providerId to the real id', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', async () => [good({ providerId: 'other' })]);
      expect((await s.quote(req())).options[0].providerId).toBe('ctt');
    });

    it('active carrier without adapter or runtime fails NOT_CONFIGURED', async () => {
      const s = setup({ carriers: ['manual', 'nope', 'ctt'], runtime: (id) => (id === 'ctt' ? null : { config: {}, secrets: {}, active: true }) });
      registerCarrierAdapter('ctt', { quote: async () => [] });
      const r = await s.quote(req());
      expect(r.failures).toEqual([
        { providerId: 'nope', code: 'NOT_CONFIGURED' },
        { providerId: 'ctt', code: 'NOT_CONFIGURED' },
      ]);
    });

    it('an adapter without quote is ignored', async () => {
      const s = setup({ carriers: ['x'] });
      registerCarrierAdapter('x', { track: async () => [] });
      expect(await s.quote(req())).toEqual({ options: [], failures: [] });
    });

    it('CTT stub yields NOT_IMPLEMENTED and manual methods remain', async () => {
      const s = setup({ carriers: ['manual', 'ctt-expresso'], methods: [method(1, 500, ['PT'])] });
      const r = await s.quote(req());
      expect(r.failures).toEqual([{ providerId: 'ctt-expresso', code: 'NOT_IMPLEMENTED' }]);
      expect(r.options).toHaveLength(1);
    });

    it('logs only id and code, never the error message', async () => {
      const s = setup({ carriers: ['ctt'] });
      s.registerCarrierQuoter('ctt', async () => {
        throw Object.assign(new Error('SECRET-MESSAGE https://x'), { code: 'UNREACHABLE' });
      });
      await s.quote(req());
      const logged = JSON.stringify(lastWarn.mock.calls);
      expect(logged).toContain('ctt');
      expect(logged).toContain('UNREACHABLE');
      expect(logged).not.toContain('SECRET-MESSAGE');
    });
  });

  describe('carrierFor and registry', () => {
    it('rejects inactive, runtime-less and adapter-less carriers', async () => {
      registerCarrierAdapter('a', { quote: async () => [] });
      const inactive = setup({ runtime: () => ({ config: {}, secrets: {}, active: false }) });
      await expect(inactive.carrierFor('a')).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
      const noRt = setup({ runtime: () => null });
      await expect(noRt.carrierFor('a')).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
      await expect(setup().carrierFor('zzz')).rejects.toMatchObject({ code: 'CARRIER_NOT_CONFIGURED' });
    });

    it('returns adapter and runtime for an active carrier; missing method is the caller concern', async () => {
      const adapter = { quote: async () => [] };
      registerCarrierAdapter('a', adapter);
      const r = await setup().carrierFor('a');
      expect(r.adapter).toMatchObject(adapter);
      expect(r.runtime).toEqual({ config: {}, secrets: {} });
    });

    it('registerCarrierAdapter merges; registerCarrierQuoter is a quote shortcut', () => {
      const track = async () => [];
      const quote = async () => [];
      registerCarrierAdapter('m', { track });
      registerCarrierAdapter('m', { quote });
      expect(getCarrierAdapter('m')).toEqual({ track, quote });
      registerCarrierQuoter('q', quote);
      expect(getCarrierAdapter('q')).toEqual({ quote });
    });

    it('reset restores only the origin CTT adapter', async () => {
      registerCarrierAdapter('m', { quote: async () => [] });
      __resetCarrierQuotersForTests();
      expect(getCarrierAdapter('m')).toBeUndefined();
      const ctt = getCarrierAdapter('ctt-expresso')!;
      await expect(ctt.createShipment!({} as any, { config: {}, secrets: {} })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    });
  });
});
