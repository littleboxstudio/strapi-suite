import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { __resetRegistryForTests } from '../../../server/src/services/modules/ecommerce/providers/registry';
import { UIDS, makeStrapi } from './helpers/settingsStrapi';

afterEach(() => __resetRegistryForTests());

const fail = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);

describe('EcommerceShippingZoneService', () => {
  it('creates a zone with a trimmed name, unique countries and the next position', async () => {
    const { zones, tables } = makeStrapi();
    const zone = await zones.create({ name: ' Continente ', countries: ['PT', 'PT'] }, '3');
    expect(zone).toEqual({ id: zone.id, name: 'Continente', countries: ['PT'], position: 1 });
    expect(tables[UIDS.shippingZone][0]).toMatchObject({ name: 'Continente', countries: { codes: ['PT'] }, position: 1 });
  });

  it('lists by position then id, reading countries as { codes } or an array', async () => {
    const { zones, tables, service } = makeStrapi();
    await service.updateStoreSettings({ markets: ['PT', 'ES', 'FR'] });
    await zones.create({ name: 'B', countries: ['ES'], position: 2 });
    await zones.create({ name: 'A', countries: ['PT'], position: 1 });
    tables[UIDS.shippingZone].push({ id: 50, name: 'Legacy', countries: ['FR'], position: 2 });
    expect((await zones.list()).map((z) => [z.name, z.countries])).toEqual([
      ['A', ['PT']],
      ['B', ['ES']],
      ['Legacy', ['FR']],
    ]);
  });

  it('validates the name and the countries', async () => {
    const { zones } = makeStrapi();
    const err = await fail(zones.create({ name: '', countries: ['PT'] }));
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'name', code: 'required' }]);
    const long = await fail(zones.create({ name: 'x'.repeat(101), countries: ['PT'] }));
    expect(long.errors).toEqual([{ path: 'name', code: 'too_long' }]);
    const none = await fail(zones.create({ name: 'Z', countries: [] }));
    expect(none.errors).toEqual([{ path: 'countries', code: 'required' }]);
    const bad = await fail(zones.create({ name: 'Z', countries: ['PT', 'ZZ'] }));
    expect(bad.errors).toEqual([{ path: 'countries.1', code: 'invalid_country' }]);
  });

  it('only accepts countries in the markets', async () => {
    const { zones } = makeStrapi();
    const err = await fail(zones.create({ name: 'Espanha', countries: ['ES'] }));
    expect(err.errors).toEqual([{ path: 'countries.0', code: 'not_in_market' }]);
  });

  it('a country belongs to one zone only; a zone may keep its own countries', async () => {
    const { zones } = makeStrapi();
    const a = await zones.create({ name: 'Continente', countries: ['PT'] });
    const err = await fail(zones.create({ name: 'Outra', countries: ['PT'] }));
    expect(err.errors).toEqual([{ path: 'countries.0', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Continente' }]);
    const updated = await zones.update(a.id, { name: 'Portugal', countries: ['PT'] });
    expect(updated).toMatchObject({ id: a.id, name: 'Portugal', countries: ['PT'], position: 1 });
  });

  it('update is partial; unknown ids are not found', async () => {
    const { zones } = makeStrapi();
    const a = await zones.create({ name: 'Continente', countries: ['PT'] });
    expect(await zones.update(a.id, { position: 5 })).toMatchObject({ name: 'Continente', countries: ['PT'], position: 5 });
    expect(await fail(zones.update(99, { name: 'x' }))).toBeInstanceOf(EcommerceNotFoundError);
    expect(await fail(zones.remove(99))).toBeInstanceOf(EcommerceNotFoundError);
  });

  it('audits create, update and delete', async () => {
    const { zones, tables } = makeStrapi();
    const a = await zones.create({ name: 'Continente', countries: ['PT'] }, 4);
    await zones.update(a.id, { name: 'PT' }, 4);
    await zones.remove(a.id, 4);
    expect(tables[UIDS.shippingZone]).toHaveLength(0);
    const logs = tables[UIDS.auditLog].filter((l) => l.action.startsWith('shipping_zone.'));
    expect(logs.map((l) => [l.area, l.action, l.targetId, l.userId])).toEqual([
      ['settings', 'shipping_zone.create', String(a.id), '4'],
      ['settings', 'shipping_zone.update', String(a.id), '4'],
      ['settings', 'shipping_zone.delete', String(a.id), '4'],
    ]);
  });

  it('the zone update audit lists the changed fields', async () => {
    const { zones, tables } = makeStrapi();
    const a = await zones.create({ name: 'Continente', countries: ['PT'] });
    await zones.update(a.id, { name: 'PT', countries: ['PT'] });
    expect(tables[UIDS.auditLog].at(-1)).toMatchObject({
      action: 'shipping_zone.update',
      details: { changedFields: ['name'] },
    });
  });

  it('a failure while removing the references keeps the zone, its rates and the carriers', async () => {
    const { zones, service, tables } = makeStrapi();
    const z1 = await zones.create({ name: 'PT', countries: ['PT'] });
    const m = await service.createManualMethod({ name: { en: 'A' }, rates: { [z1.id]: 500 } });
    await service.updateIntegration('ctt-expresso', { config: { zones: [z1.id] } });
    const spy = vi.spyOn(service, 'removeZoneReferences');
    // Partial cleanup, then a failure: the transaction must undo both.
    spy.mockImplementationOnce(async () => {
      tables[UIDS.manualShippingMethod][0].rates = {};
      throw new Error('db down');
    });
    expect((await fail(zones.remove(z1.id))).message).toBe('db down');
    expect(tables[UIDS.shippingZone].map((z) => z.id)).toEqual([z1.id]);
    expect((await service.listManualMethods()).find((x) => x.id === m.id)!.rates).toEqual({ [z1.id]: 500 });
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([z1.id]);
    expect(tables[UIDS.auditLog].some((l) => l.action === 'shipping_zone.delete')).toBe(false);
  });

  it('deleting a zone removes its rates and its id from the carriers, and refreshes the runtime cache', async () => {
    const { zones, service, tables } = makeStrapi();
    await service.updateStoreSettings({ markets: ['PT', 'ES'] });
    const z1 = await zones.create({ name: 'PT', countries: ['PT'] });
    const z2 = await zones.create({ name: 'ES', countries: ['ES'] });
    const a = await service.createManualMethod({ name: { en: 'A' }, rates: { [z1.id]: 500, [z2.id]: 900 } });
    const b = await service.createManualMethod({ name: { en: 'B' }, rates: { [z1.id]: 300 } });
    const c = await service.createManualMethod({ name: { en: 'C' }, rates: { [z2.id]: 100 } });
    await service.updateIntegration('ctt-expresso', { config: { zones: [z1.id, z2.id] } });
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([z1.id, z2.id]);

    await zones.remove(z1.id, 5);

    const methods = Object.fromEntries((await service.listManualMethods()).map((m) => [m.id, m.rates]));
    expect(methods).toEqual({ [a.id]: { [z2.id]: 900 }, [b.id]: {}, [c.id]: { [z2.id]: 100 } });
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([z2.id]);
    expect(tables[UIDS.auditLog].at(-1)).toMatchObject({
      action: 'shipping_zone.delete',
      targetId: String(z1.id),
      userId: '5',
      details: { methods: [a.id, b.id], carriers: ['ctt-expresso'] },
    });
  });

  it('deleting the last zone of a carrier leaves it without zones', async () => {
    const { zones, service } = makeStrapi();
    const z1 = await zones.create({ name: 'PT', countries: ['PT'] });
    await service.updateIntegration('ctt-expresso', { config: { zones: [z1.id] } });
    await zones.remove(z1.id);
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([]);
  });
});
