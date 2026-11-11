import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createController from '../../../server/src/controllers/modules/ecommerce/settings';
import EcommerceSettingsService from '../../../server/src/services/modules/ecommerce/settings';
import EcommerceEmailTemplateService from '../../../server/src/services/modules/ecommerce/email/templates';
import EcommerceAuditService from '../../../server/src/services/modules/ecommerce/audit';
import { __resetRegistryForTests } from '../../../server/src/services/modules/ecommerce/providers/registry';
import { createFakeDb } from './helpers/fakeDb';

const mocked = (services: Record<string, any>) =>
  createController({ strapi: { plugin: () => ({ service: (n: string) => services[n] }) } as any });

const mkCtx = (extra: any = {}): any => ({
  params: {},
  request: { body: {} },
  state: { user: { id: 7 } },
  badRequest: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});

describe('EcommerceSettingsController — store logo', () => {
  it('requires a single file', async () => {
    const c = mocked({ EcommerceSettingsService: {} });
    const ctx = mkCtx({ request: { body: {}, files: {} } });
    await c.uploadStoreLogo(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('A file is required');
    const ctx2 = mkCtx({ request: { body: {}, files: { file: [{}] } } });
    await c.uploadStoreLogo(ctx2);
    expect(ctx2.badRequest).toHaveBeenCalledWith('A file is required');
  });

  it('rejects logos over 400 KB', async () => {
    const c = mocked({ EcommerceSettingsService: {} });
    const ctx = mkCtx({ request: { body: {}, files: { file: { size: 400 * 1024 + 1, filepath: '/x' } } } });
    await c.uploadStoreLogo(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('The logo exceeds 400 KB');
  });

  it('maps INVALID_IMAGE to 400 with details.code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
    const filepath = path.join(dir, 'x.png');
    fs.writeFileSync(filepath, 'x');
    const c = mocked({
      EcommerceSettingsService: { uploadStoreLogo: vi.fn().mockRejectedValue(new Error('INVALID_IMAGE')) },
    });
    const ctx = mkCtx({ request: { body: {}, files: { file: { size: 1, filepath } } } });
    await c.uploadStoreLogo(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'INVALID_IMAGE' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps UPLOAD_FAILED to 400 with details.code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
    const filepath = path.join(dir, 'x.png');
    fs.writeFileSync(filepath, 'x');
    const c = mocked({
      EcommerceSettingsService: { uploadStoreLogo: vi.fn().mockRejectedValue(new Error('UPLOAD_FAILED')) },
    });
    const ctx = mkCtx({ request: { body: {}, files: { file: { size: 1, filepath } } } });
    await c.uploadStoreLogo(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'UPLOAD_FAILED' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('EcommerceSettingsController — domain errors', () => {
  it('maps validation errors to 400 with details.errors', async () => {
    const errors = [{ path: 'supportEmail', code: 'invalid_email' }];
    const c = mocked({ EcommerceSettingsService: { updateStoreSettings: vi.fn().mockRejectedValue(new EcommerceValidationError('x', errors)) } });
    const ctx = mkCtx();
    await c.updateStore(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { errors });
  });

  it('maps not found to 404', async () => {
    const c = mocked({ EcommerceSettingsService: { testConnection: vi.fn().mockRejectedValue(new EcommerceNotFoundError('x')) } });
    const ctx = mkCtx();
    await c.testIntegration(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('maps secret and email errors to 400 with details.code', async () => {
    const c = mocked({
      EcommerceSettingsService: { updateIntegration: vi.fn().mockRejectedValue(new EcommerceSecretError('ENCRYPTION_KEY_MISSING')) },
      EcommerceEmailTemplateService: { sendTest: vi.fn().mockRejectedValue(new EcommerceEmailError('EMAIL_NOT_CONFIGURED')) },
    });
    const ctx1 = mkCtx();
    await c.updateIntegration(ctx1);
    expect(ctx1.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'ENCRYPTION_KEY_MISSING' });
    const ctx2 = mkCtx();
    await c.sendTestEmail(ctx2);
    expect(ctx2.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'EMAIL_NOT_CONFIGURED' });
  });

  it('getLocales serves the same payload as the products locales endpoint', async () => {
    const productController = {
      getLocales: vi.fn(async (ctx: any) => {
        ctx.body = { defaultLocale: 'en', locales: [{ code: 'en', name: 'English' }], aiAvailable: false };
      }),
    };
    const c = createController({
      strapi: {
        plugin: () => ({
          service: () => undefined,
          controller: (n: string) => (n === 'EcommerceProductController' ? productController : undefined),
        }),
      } as any,
    });
    const ctx = mkCtx();
    await c.getLocales(ctx);
    expect(productController.getLocales).toHaveBeenCalledWith(ctx);
    expect(ctx.body).toEqual({ defaultLocale: 'en', locales: [{ code: 'en', name: 'English' }], aiAvailable: false });
  });

  it('rethrows unknown errors', async () => {
    const c = mocked({ EcommerceSettingsService: { getStoreSettings: vi.fn().mockRejectedValue(new Error('boom')) } });
    await expect(c.getStore(mkCtx())).rejects.toThrow('boom');
  });

  it('passes the user id as a string, or undefined when absent', async () => {
    const save = vi.fn().mockResolvedValue({});
    const c = mocked({ EcommerceSettingsService: { updateStoreSettings: save } });
    await c.updateStore(mkCtx({ request: { body: { storeName: 'A' } } }));
    expect(save).toHaveBeenLastCalledWith({ storeName: 'A' }, '7');
    await c.updateStore(mkCtx({ state: {} }));
    expect(save).toHaveBeenLastCalledWith({}, undefined);
  });

  it('activate requires a boolean', async () => {
    const setActive = vi.fn();
    const c = mocked({ EcommerceSettingsService: { setActive } });
    const ctx = mkCtx({ request: { body: { active: 'yes' } } });
    await c.setIntegrationActive(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('create answers 201 and delete 204', async () => {
    const c = mocked({
      EcommerceSettingsService: {
        createManualMethod: vi.fn().mockResolvedValue({ id: 1 }),
        deleteManualMethod: vi.fn().mockResolvedValue(undefined),
      },
    });
    const ctx = mkCtx();
    await c.createShippingMethod(ctx);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 1 });
    const ctx2 = mkCtx({ params: { id: '1' } });
    await c.deleteShippingMethod(ctx2);
    expect(ctx2.status).toBe(204);
  });
});

describe('EcommerceSettingsController — shipping zones', () => {
  it('lists, creates (201), updates and deletes (204) through the zone service', async () => {
    const zoneService = {
      list: vi.fn().mockResolvedValue([{ id: 1 }]),
      create: vi.fn().mockResolvedValue({ id: 2 }),
      update: vi.fn().mockResolvedValue({ id: 2, name: 'B' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const c = mocked({ EcommerceShippingZoneService: zoneService });
    const list = mkCtx();
    await c.listShippingZones(list);
    expect(list.body).toEqual([{ id: 1 }]);
    const create = mkCtx({ request: { body: { name: 'A', countries: ['PT'] } } });
    await c.createShippingZone(create);
    expect(create.status).toBe(201);
    expect(zoneService.create).toHaveBeenCalledWith({ name: 'A', countries: ['PT'] }, '7');
    const update = mkCtx({ params: { id: '2' }, request: { body: { name: 'B' } } });
    await c.updateShippingZone(update);
    expect(zoneService.update).toHaveBeenCalledWith(2, { name: 'B' }, '7');
    expect(update.body).toEqual({ id: 2, name: 'B' });
    const del = mkCtx({ params: { id: '2' } });
    await c.deleteShippingZone(del);
    expect(zoneService.remove).toHaveBeenCalledWith(2, '7');
    expect(del.status).toBe(204);
  });

  it('maps ZONE_COUNTRY_CONFLICT and MARKET_IN_USE to 409 ConflictError with details.code', async () => {
    for (const [code, call] of [
      ['ZONE_COUNTRY_CONFLICT', 'createShippingZone'],
      ['MARKET_IN_USE', 'updateStore'],
    ] as const) {
      const errors = [{ path: code === 'MARKET_IN_USE' ? 'markets' : 'countries.0', code, detail: 'Ibéria' }];
      const rejected = vi.fn().mockRejectedValue(new EcommerceValidationError('x', errors));
      const c = mocked({
        EcommerceShippingZoneService: { create: rejected },
        EcommerceSettingsService: { updateStoreSettings: rejected },
      });
      const ctx = mkCtx();
      await (c as any)[call](ctx);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error).toMatchObject({ status: 409, name: 'ConflictError', details: { code, errors } });
    }
  });
});

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  integration: `${P}integration`,
  storeSetting: `${P}store-setting`,
  manualShippingMethod: `${P}manual-shipping-method`,
  auditLog: `${P}audit-log`,
  emailTemplate: `${P}email-template`,
  emailTemplateVersion: `${P}email-template-version`,
};

function realController() {
  const db = createFakeDb(Object.values(UIDS));
  const pluginConfig: any = { uuid: { modules: { ecommerce: UIDS } }, ecommerce: { encryptionKey: 'key-one' } };
  const services: Record<string, any> = {};
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => pluginConfig },
    plugin: (id: string) =>
      id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [{ code: 'en', name: 'English' }, { code: 'pt', name: 'Portuguese' }],
            }),
          }
        : { service: (n: string) => services[n] },
  };
  services.EcommerceAuditService = EcommerceAuditService({ strapi });
  services.EcommerceSettingsService = EcommerceSettingsService({ strapi });
  services.EcommerceEmailTemplateService = EcommerceEmailTemplateService({ strapi });
  return createController({ strapi });
}

describe('EcommerceSettingsController — real services', () => {
  afterEach(() => __resetRegistryForTests());

  it('never returns a plaintext secret from any integration endpoint', async () => {
    const c = realController();
    const SECRET = 'sk_test_51ABCDEFsecretvalue9876';
    const bodies: unknown[] = [];

    const put = mkCtx({ params: { id: 'stripe' }, request: { body: { config: {}, secrets: { secretKey: SECRET } } } });
    await c.updateIntegration(put);
    bodies.push(put.body, put.badRequest.mock.calls);

    const act = mkCtx({ params: { id: 'stripe' }, request: { body: { active: true } } });
    await c.setIntegrationActive(act);
    bodies.push(act.body, act.badRequest.mock.calls);

    const list = mkCtx();
    await c.listIntegrations(list);
    bodies.push(list.body);

    const stripe = (list.body as any[]).find((i) => i.id === 'stripe');
    expect(stripe).toBeDefined();
    expect(stripe.secrets.secretKey).toBeTruthy();
    expect(JSON.stringify(bodies)).not.toContain(SECRET);
  });

  it('answers 404 for an unknown template type and 400 for an unknown locale', async () => {
    const c = realController();
    const a = mkCtx({ params: { type: 'nope', locale: 'en' } });
    await c.getEmailTemplate(a);
    expect(a.notFound).toHaveBeenCalled();
    const b = mkCtx({ params: { type: 'ORDER_CONFIRMATION', locale: 'xx' } });
    await c.getEmailTemplate(b);
    expect(b.badRequest).toHaveBeenCalledWith(expect.any(String), { errors: [{ path: 'locale', code: 'invalid_locale' }] });
  });

  it('rejects a test e-mail with an invalid recipient', async () => {
    const c = realController();
    const ctx = mkCtx({ params: { type: 'ORDER_CONFIRMATION', locale: 'en' }, request: { body: { to: 'not-an-email' } } });
    await c.sendTestEmail(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { errors: [{ path: 'to', code: 'invalid_email' }] });
  });
});

describe('EcommerceSettingsController - listApiTokens', () => {
  it('lists the tokens of the calling admin without secrets or permissions', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 1, name: 'BFF', type: 'custom', expiresAt: null, accessKey: 'secret', permissions: ['x'], description: 'd', lastUsedAt: null },
      { id: 2, name: 'Site', type: 'read-only', expiresAt: '2030-01-01T00:00:00.000Z', accessKey: 'secret2' },
    ]);
    const c = createController({
      strapi: { plugin: () => ({ service: () => ({}) }), service: (n: string) => (n === 'admin::api-token' ? { list } : undefined) } as any,
    });
    const ctx = mkCtx();
    await c.listApiTokens(ctx);
    expect(list).toHaveBeenCalledWith({ id: 7 });
    expect(ctx.body).toEqual([
      { id: 1, name: 'BFF', type: 'custom', expiresAt: null },
      { id: 2, name: 'Site', type: 'read-only', expiresAt: '2030-01-01T00:00:00.000Z' },
    ]);
    expect(JSON.stringify(ctx.body)).not.toContain('secret');
  });
});
