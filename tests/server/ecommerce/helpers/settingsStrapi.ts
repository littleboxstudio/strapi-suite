import { vi } from 'vitest';
import EcommerceSettingsService from '../../../../server/src/services/modules/ecommerce/settings';
import EcommerceAuditService from '../../../../server/src/services/modules/ecommerce/audit';
import EcommerceImageService from '../../../../server/src/services/modules/ecommerce/images';
import { createFakeDb } from './fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
export const UIDS = {
  integration: `${P}integration`,
  storeSetting: `${P}store-setting`,
  manualShippingMethod: `${P}manual-shipping-method`,
  auditLog: `${P}audit-log`,
};

type FakeApiToken = {
  id: number;
  name: string;
  description: string | null;
  type: 'read-only' | 'full-access' | 'custom';
  kind: 'content-api';
  permissions: string[];
  lifespan: number | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * In-memory stand-in for `strapi.service('admin::api-token')` (content-API tokens): names are
 * unique like in Strapi, `create` returns the plain `accessKey` once, `revoke` of a missing id
 * returns null.
 */
export function createFakeApiTokens() {
  const rows = new Map<number, FakeApiToken & { accessKey: string }>();
  let nextId = 1;
  const view = (row: FakeApiToken & { accessKey: string }): FakeApiToken => {
    const { accessKey: _omit, ...rest } = row;
    return { ...rest, permissions: [...rest.permissions] };
  };
  const seed = (attrs: Partial<FakeApiToken> & { name: string }): FakeApiToken => {
    const id = attrs.id ?? nextId;
    nextId = Math.max(nextId, id + 1);
    const now = new Date().toISOString();
    const row = {
      description: null,
      type: 'custom' as const,
      permissions: [],
      lifespan: null,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      ...attrs,
      id,
      kind: 'content-api' as const,
      accessKey: `access-key-${id}`,
    };
    rows.set(id, row);
    return view(row);
  };
  const service = {
    getById: vi.fn(async (id: number) => {
      const row = rows.get(id);
      return row ? view(row) : null;
    }),
    exists: vi.fn(async (where: Record<string, unknown>) =>
      [...rows.values()].some((r) => Object.entries(where).every(([k, v]) => (r as any)[k] === v))
    ),
    create: vi.fn(async (attrs: any) => {
      if ([...rows.values()].some((r) => r.name === attrs.name)) throw new Error('Unique constraint: name');
      const created = seed({ ...attrs, expiresAt: attrs.lifespan ? new Date(Date.now() + attrs.lifespan).toISOString() : null });
      return { ...created, accessKey: rows.get(created.id)!.accessKey };
    }),
    revoke: vi.fn(async (id: number) => {
      const row = rows.get(id);
      rows.delete(id);
      return row ? view(row) : null;
    }),
  };
  return { service, rows, seed };
}

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
  const apiTokens = createFakeApiTokens();
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    service: (name: string) => (name === 'admin::api-token' ? apiTokens.service : undefined),
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
  return {
    service: services.EcommerceSettingsService as ReturnType<typeof EcommerceSettingsService>,
    strapi,
    provider,
    apiTokens,
    tables: db.tables,
    pluginConfig,
    transaction: db.transaction,
  };
}
