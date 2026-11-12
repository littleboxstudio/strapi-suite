import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceShippingService, {
  __resetCarrierQuotersForTests,
  getCarrierAdapter,
  registerCarrierAdapter,
  registerCarrierQuoter,
} from '../../../server/src/services/modules/ecommerce/shipping';

const method = (id: number, rates: Record<string, { upTo: number; price: number }[]>, extra = {}) => ({
  id, name: { pt: `M${id}`, en: `M${id}en` }, rates, tax: 23, active: true, position: id, ...extra,
});

const FLAT = (price: number) => [{ upTo: 1000, price }];
/** The runtime of a carrier serving PT. */
const RUNTIME = { config: { markets: ['PT'] }, secrets: {}, active: true };

let lastWarn: ReturnType<typeof vi.fn>;
function setup(
  opts: { carriers?: string[]; methods?: any[]; countries?: string[]; runtime?: (id: string) => any } = {}
) {
  const settings = {
    listManualMethods: async () => opts.methods ?? [],
    getStoreSettings: async () => ({ markets: opts.countries ?? ['PT', 'ES', 'FR'] }),
    getActiveProviders: async () => opts.carriers ?? ['manual'],
    getRuntime: async (id: string) => (opts.runtime ? opts.runtime(id) : RUNTIME),
  };
  const warn = vi.fn();
  lastWarn = warn;
  const strapi: any = {
    log: { warn },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'pt' }) }
        : { service: () => settings },
  };
  return EcommerceShippingService({ strapi });
}

const item = (weight: number, quantity = 1) => ({ variantId: 1, quantity, weight, width: 0, height: 0, depth: 0 });
const req = (country = 'PT', items: any[] = []) => ({ country, items, subtotal: 1000, locale: 'en' });

beforeEach(() => __resetCarrierQuotersForTests());

describe('EcommerceShippingService', () => {
  it('a manual method is priced by the order weight in the country brackets', async () => {
    const s = setup({
      methods: [method(1, { PT: [{ upTo: 1, price: 300 }, { upTo: 5, price: 1000 }] }), method(3, { PT: FLAT(100) }, { active: false })],
    });
    const light = await s.quote(req('PT', [item(0.4, 2)]));
    expect(light.options.map((o) => o.serviceId)).toEqual(['1']);
    expect(light.options[0]).toMatchObject({ providerId: 'manual', name: 'M1en', price: 300, tax: 23 });
    expect((await s.quote(req('PT', [item(3)]))).options[0].price).toBe(1000);
    expect(await s.quote(req('PT', [item(6)]))).toEqual({ options: [], failures: [] });
  });

  it('a manual method without brackets for the country is not offered', async () => {
    const s = setup({ methods: [method(1, { PT: FLAT(500) })] });
    expect(await s.quote(req('ES', [item(0.5)]))).toEqual({ options: [], failures: [] });
  });

  it('ignores stored rates that are not brackets (old zone shape)', async () => {
    const s = setup({ methods: [{ ...method(1, {}), rates: { PT: 500, '1': 300 } }] });
    expect(await s.quote(req('PT', [item(0.5)]))).toEqual({ options: [], failures: [] });
  });

  it('a country outside the markets has no options, even with a carrier serving it', async () => {
    const s = setup({
      carriers: ['manual', 'ctt'],
      methods: [method(1, { DE: FLAT(500) })],
      runtime: () => ({ config: { markets: ['DE'] }, secrets: {}, active: true }),
    });
    const quoter = vi.fn(async () => []);
    s.registerCarrierQuoter('ctt', quoter);
    expect(await s.quote(req('DE'))).toEqual({ options: [], failures: [] });
    expect(quoter).not.toHaveBeenCalled();
  });

  it('a carrier is only asked for the markets in its configuration', async () => {
    const s = setup({ carriers: ['ctt'], runtime: () => ({ config: { markets: ['ES'] }, secrets: {}, active: true }) });
    const quoter = vi.fn(async () => []);
    s.registerCarrierQuoter('ctt', quoter);
    expect(await s.quote(req('PT'))).toEqual({ options: [], failures: [] });
    expect(quoter).not.toHaveBeenCalled();
    await s.quote(req('ES'));
    expect(quoter).toHaveBeenCalledTimes(1);
    expect((quoter.mock.calls[0] as any)[0]).toMatchObject({ country: 'ES' });
    expect((quoter.mock.calls[0] as any)[0]).not.toHaveProperty('zoneId');
  });

  it('a carrier without markets in its configuration is never asked and does not fail', async () => {
    const s = setup({ carriers: ['ctt'], runtime: () => ({ config: {}, secrets: {}, active: true }) });
    const quoter = vi.fn(async () => []);
    s.registerCarrierQuoter('ctt', quoter);
    expect(await s.quote(req('PT'))).toEqual({ options: [], failures: [] });
    expect(quoter).not.toHaveBeenCalled();
  });

  it('falls back to the default locale and ignores manual when inactive', async () => {
    const s = setup({ methods: [method(1, { PT: FLAT(1) }, { name: { pt: 'Só PT' } })] });
    expect((await s.quote(req())).options[0].name).toBe('Só PT');
    const off = setup({ carriers: [], methods: [method(1, { PT: FLAT(1) })] });
    expect((await off.quote(req())).options).toEqual([]);
  });

  it('a failing carrier does not hide manual methods', async () => {
    const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, { PT: FLAT(500) })] });
    s.registerCarrierQuoter('ctt', async () => {
      throw Object.assign(new Error('x'), { code: 'UNREACHABLE' });
    });
    const r = await s.quote(req());
    expect(r.options).toHaveLength(1);
    expect(r.failures).toEqual([{ providerId: 'ctt', code: 'UNREACHABLE' }]);
  });

  it('merges carrier options and sorts by price then name', async () => {
    const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, { PT: FLAT(500) }), method(2, { PT: FLAT(500) }, { name: { pt: 'A', en: 'A' } })] });
    s.registerCarrierQuoter('ctt', async () => [{ providerId: 'ctt', serviceId: 'e', name: 'Exp', price: 300, tax: 23 }]);
    const { options } = await s.quote(req());
    expect(options.map((o) => `${o.providerId}:${o.serviceId}`)).toEqual(['ctt:e', 'manual:2', 'manual:1']);
  });

  it('hands the adapter an explicit 8 s timeout', async () => {
    const s = setup({ carriers: ['ctt'] });
    const quoter = vi.fn(async () => []);
    s.registerCarrierQuoter('ctt', quoter);
    await s.quote(req());
    expect(quoter).toHaveBeenCalledWith(req(), { config: { markets: ['PT'] }, secrets: {} }, { timeoutMs: 8000 });
  });

  it('findOption returns the option or null', async () => {
    const s = setup({ methods: [method(1, { PT: FLAT(500) })] });
    expect(await s.findOption(req(), 'manual', '1')).toMatchObject({ price: 500 });
    expect(await s.findOption(req(), 'manual', '99')).toBeNull();
    expect(await s.findOption(req('ES'), 'manual', '1')).toBeNull();
  });

  describe('hardened quotes', () => {
    const good = (over = {}) => ({ providerId: 'ctt', serviceId: 'e', name: 'Exp', price: 300, tax: 23, ...over });

    it('times out a never-resolving quoter after 8 s and keeps manual methods', async () => {
      vi.useFakeTimers();
      try {
        const s = setup({ carriers: ['manual', 'ctt'], methods: [method(1, { PT: FLAT(500) })] });
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
          runtime: (id) => (id === 'a' ? new Promise(() => undefined) : RUNTIME),
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
      const s = setup({ carriers: ['manual', 'nope', 'ctt'], runtime: (id) => (id === 'ctt' ? null : RUNTIME) });
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
      const s = setup({ carriers: ['manual', 'ctt-expresso'], methods: [method(1, { PT: FLAT(500) })] });
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
      expect(r.runtime).toEqual({ config: { markets: ['PT'] }, secrets: {} });
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
