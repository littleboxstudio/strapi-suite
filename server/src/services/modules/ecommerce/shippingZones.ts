import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError, ValidationIssue } from './errors';
import type { AuditEntry } from './audit';
import { validateCountries } from './settings';

const AREA = 'settings';
const NAME_MAX = 100;

/** A group of market countries that share the shipping prices of each method. */
export type ShippingZone = { id: number; name: string; countries: string[]; position: number };

export type ShippingZoneInput = { name?: string; countries?: string[]; position?: number };

/** `countries` is stored as `{ codes }` (json columns only take objects); arrays are read too. */
const readCountries = (stored: unknown): string[] => {
  const list = Array.isArray(stored)
    ? stored
    : stored && typeof stored === 'object' && Array.isArray((stored as { codes?: unknown }).codes)
    ? (stored as { codes: unknown[] }).codes
    : [];
  return list.filter((c): c is string => typeof c === 'string');
};

const toZone = (r: any): ShippingZone => ({
  id: r.id,
  name: r.name ?? '',
  countries: readCountries(r.countries),
  position: r.position ?? 0,
});

const EcommerceShippingZoneService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const q = () => strapi.db.query(uids().shippingZone);
  const settings = () => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');
  const audit = (entry: AuditEntry): Promise<void> =>
    strapi.plugin(PLUGIN_ID).service('EcommerceAuditService').log(entry);
  const auditUser = (userId?: string | number) => (userId === undefined ? undefined : String(userId));

  const list = async (): Promise<ShippingZone[]> => {
    const rows = await q().findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    return rows.map(toZone);
  };

  /** Validates the merged zone and returns the values to store. */
  const normalize = async (
    input: ShippingZoneInput,
    selfId?: number
  ): Promise<{ name: string; countries: string[]; position?: number }> => {
    const errors: ValidationIssue[] = [];

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '') errors.push({ path: 'name', code: 'required' });
    else if (name.length > NAME_MAX) errors.push({ path: 'name', code: 'too_long' });

    const before = errors.length;
    validateCountries(input.countries, 'countries', errors);
    const countries = errors.length === before ? [...new Set(input.countries as string[])] : [];
    if (countries.length) {
      const markets: string[] = (await settings().getStoreSettings()).markets ?? [];
      const others = (await list()).filter((z) => z.id !== selfId);
      countries.forEach((c, i) => {
        if (!markets.includes(c)) {
          errors.push({ path: `countries.${i}`, code: 'not_in_market' });
          return;
        }
        const owner = others.find((z) => z.countries.includes(c));
        if (owner) errors.push({ path: `countries.${i}`, code: 'ZONE_COUNTRY_CONFLICT', detail: owner.name });
      });
    }

    const position = input.position;
    if (position !== undefined && position !== null && (typeof position !== 'number' || !Number.isInteger(position))) {
      errors.push({ path: 'position', code: 'invalid_number' });
    }

    if (errors.length) throw new EcommerceValidationError('Invalid settings', errors);
    return { name, countries, ...(typeof position === 'number' ? { position } : {}) };
  };

  const findExisting = async (id: number) => {
    const existing = await q().findOne({ where: { id } });
    if (!existing) throw new EcommerceNotFoundError('Shipping zone not found');
    return existing;
  };

  return {
    list,

    async create(input: ShippingZoneInput, userId?: string | number): Promise<ShippingZone> {
      const values = await normalize(input ?? {});
      let position = values.position;
      if (position === undefined) {
        const all = await q().findMany({});
        position = all.reduce((max: number, r: any) => Math.max(max, r.position ?? 0), 0) + 1;
      }
      const created = await q().create({
        data: { name: values.name, countries: { codes: values.countries }, position },
      });
      await audit({ area: AREA, action: 'shipping_zone.create', targetId: String(created.id), userId: auditUser(userId) });
      return toZone(created);
    },

    async update(id: number, input: ShippingZoneInput, userId?: string | number): Promise<ShippingZone> {
      const { id: _id, ...current } = toZone(await findExisting(id));
      const values = await normalize({ ...current, ...(input ?? {}) }, id);
      const updated = await q().update({
        where: { id },
        data: {
          name: values.name,
          countries: { codes: values.countries },
          ...(values.position !== undefined ? { position: values.position } : {}),
        },
      });
      await audit({ area: AREA, action: 'shipping_zone.update', targetId: String(id), userId: auditUser(userId) });
      return toZone(updated);
    },

    /** Deletes the zone and, in the same transaction, its rates and carrier references. */
    async remove(id: number, userId?: string | number): Promise<void> {
      await findExisting(id);
      const references: { methods: number[]; carriers: string[] } = await strapi.db.transaction(async () => {
        await q().delete({ where: { id } });
        return settings().removeZoneReferences(id);
      });
      // Again after the commit, so no read during the transaction keeps the old runtime cached.
      settings().invalidateRuntimes();
      await audit({
        area: AREA,
        action: 'shipping_zone.delete',
        targetId: String(id),
        userId: auditUser(userId),
        details: references,
      });
    },
  };
};

export default EcommerceShippingZoneService;
