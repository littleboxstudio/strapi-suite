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
