import { vi } from 'vitest';
import EcommerceSettingsService from '../../../../server/src/services/modules/ecommerce/settings';
import EcommerceShippingZoneService from '../../../../server/src/services/modules/ecommerce/shippingZones';
import EcommerceAuditService from '../../../../server/src/services/modules/ecommerce/audit';
import EcommerceImageService from '../../../../server/src/services/modules/ecommerce/images';
import { createFakeDb } from './fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
export const UIDS = {
  integration: `${P}integration`,
  storeSetting: `${P}store-setting`,
  manualShippingMethod: `${P}manual-shipping-method`,
  shippingZone: `${P}shipping-zone`,
  auditLog: `${P}audit-log`,
};

/**
 * A fake Strapi with the real settings, shipping zone, audit and image services over one
 * in-memory database.
 */
export function makeStrapi(opts: { encryptionKey?: string | null } = {}) {
  const db = createFakeDb(Object.values(UIDS));
  const pluginConfig: any = {
    uuid: { modules: { ecommerce: UIDS } },
    ecommerce: { encryptionKey: opts.encryptionKey === undefined ? 'key-one' : opts.encryptionKey },
  };
  const services: Record<string, any> = {};
  const provider = {
    upload: vi.fn(async (file: any) => {
      file.url = `/uploads/${file.hash}${file.ext}`;
    }),
    delete: vi.fn(async () => undefined),
  };
  const apiTokenGetById = vi.fn(async (id: number) => (id === 7 ? { id: 7 } : null));
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    service: (name: string) => (name === 'admin::api-token' ? { getById: apiTokenGetById } : undefined),
    config: { get: (k?: string) => (k === 'plugin::upload' ? { provider: 'local' } : pluginConfig) },
    log: { warn: vi.fn() },
    plugin: (id: string) =>
      id === 'upload'
        ? { provider }
        : id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [
                { code: 'en', name: 'English' },
                { code: 'pt', name: 'Portuguese' },
              ],
            }),
          }
        : { service: (name: string) => services[name] },
  };
  services.EcommerceAuditService = EcommerceAuditService({ strapi });
  services.EcommerceImageService = EcommerceImageService({ strapi });
  services.EcommerceSettingsService = EcommerceSettingsService({ strapi });
  services.EcommerceShippingZoneService = EcommerceShippingZoneService({ strapi });
  return {
    service: services.EcommerceSettingsService as ReturnType<typeof EcommerceSettingsService>,
    zones: services.EcommerceShippingZoneService as ReturnType<typeof EcommerceShippingZoneService>,
    strapi,
    provider,
    apiTokenGetById,
    tables: db.tables,
    pluginConfig,
    transaction: db.transaction,
  };
}
