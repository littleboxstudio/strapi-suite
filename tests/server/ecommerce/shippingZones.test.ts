import { afterEach, describe, expect, it } from 'vitest';
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
});
