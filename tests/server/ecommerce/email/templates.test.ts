import { afterEach, describe, expect, it, vi } from 'vitest';
import EcommerceEmailTemplateService from '../../../../server/src/services/modules/ecommerce/email/templates';
import EcommerceAuditService from '../../../../server/src/services/modules/ecommerce/audit';
import { DEFAULT_TEMPLATES } from '../../../../server/src/services/modules/ecommerce/email/defaults';
import {
  EMAIL_TEMPLATE_TYPES,
  getSampleData,
} from '../../../../server/src/services/modules/ecommerce/email/catalog';
import { validateTemplate } from '../../../../server/src/services/modules/ecommerce/email/templateEngine';
import {
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../../server/src/services/modules/ecommerce/errors';
import { STORE_SETTINGS_DEFAULTS } from '../../../../server/src/services/modules/ecommerce/settings';
import { createFakeDb } from '../helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  emailTemplate: `${P}email-template`,
  emailTemplateVersion: `${P}email-template-version`,
  auditLog: `${P}audit-log`,
};

const VALID = {
  subject: 'Order {{order.reference}}',
  html: '<p>Hi {{customer.firstName}}, thanks for shopping at {{store.name}}.</p>',
};

function makeStrapi(opts: { runtime?: any } = {}) {
  const db = createFakeDb(Object.values(UIDS));
  const pluginConfig: any = { uuid: { modules: { ecommerce: UIDS } } };
  const settings = {
    getStoreSettings: vi.fn(async () => ({
      ...STORE_SETTINGS_DEFAULTS,
      storeName: 'Acme',
      brandColor: '#123456',
      storefrontUrl: 'https://acme.example',
      supportEmail: 'help@acme.example',
    })),
    getRuntime: vi.fn(async () => opts.runtime ?? null),
  };
  let audit: any;
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => pluginConfig },
    plugin: (id: string) =>
      id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [
                { code: 'en', name: 'English' },
                { code: 'pt', name: 'Portuguese' },
              ],
            }),
          }
        : {
            service: (name: string) =>
              name === 'EcommerceAuditService'
                ? audit
                : name === 'EcommerceSettingsService'
                  ? settings
                  : undefined,
          },
  };
  audit = EcommerceAuditService({ strapi });
  const service = EcommerceEmailTemplateService({ strapi });
  return { service, tables: db.tables, settings };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('default templates', () => {
  it('ships one default per type', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...EMAIL_TEMPLATE_TYPES].sort());
  });

  it.each(EMAIL_TEMPLATE_TYPES)('%s passes validateTemplate with zero issues', (type) => {
    const { subject, html } = DEFAULT_TEMPLATES[type];
    expect(validateTemplate(type, subject, html)).toEqual([]);
  });
});

describe('EcommerceEmailTemplateService', () => {
  it('get without customization returns the default', async () => {
    const { service } = makeStrapi();
    const t = await service.get('ORDER_CONFIRMATION', 'pt');
    expect(t).toMatchObject({
      type: 'ORDER_CONFIRMATION',
      locale: 'pt',
      subject: DEFAULT_TEMPLATES.ORDER_CONFIRMATION.subject,
      html: DEFAULT_TEMPLATES.ORDER_CONFIRMATION.html,
      isCustom: false,
      version: 1,
    });
    expect(t.variables.map((v) => v.path)).toContain('order.items');
  });

  it('rejects unknown types and locales', async () => {
    const { service } = makeStrapi();
    await expect(service.get('NOPE' as any, 'en')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.save('ORDER_CONFIRMATION', 'xx', VALID, 1)).rejects.toBeInstanceOf(
      EcommerceValidationError
    );
  });

  it('save with invalid HTML throws and writes nothing', async () => {
    const { service, tables } = makeStrapi();
    const err = await service
      .save('ORDER_CONFIRMATION', 'en', { subject: '{{nope}}', html: '<script>x</script>' }, 1)
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'html', code: 'UNSAFE_HTML' }),
        expect.objectContaining({ path: 'subject', code: 'UNKNOWN_VARIABLE' }),
      ])
    );
    expect(tables[UIDS.emailTemplate]).toHaveLength(0);
    expect(tables[UIDS.emailTemplateVersion]).toHaveLength(0);
    expect(tables[UIDS.auditLog]).toHaveLength(0);
  });

  it('saving twice keeps 2 versions and reaches version 3', async () => {
    const { service, tables } = makeStrapi();
    await service.save('ORDER_CONFIRMATION', 'en', VALID, 1);
    await service.save('ORDER_CONFIRMATION', 'en', { ...VALID, subject: 'Second {{order.reference}}' }, 2);

    const t = await service.get('ORDER_CONFIRMATION', 'en');
    expect(t).toMatchObject({ isCustom: true, version: 3, subject: 'Second {{order.reference}}' });
    const versions = await service.listVersions('ORDER_CONFIRMATION', 'en');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].subject).toBe(DEFAULT_TEMPLATES.ORDER_CONFIRMATION.subject);
    expect(versions[0].subject).toBe(VALID.subject);
    expect(tables[UIDS.emailTemplate]).toHaveLength(1);
    expect(tables[UIDS.auditLog].map((a) => a.action)).toEqual([
      'email_template.save',
      'email_template.save',
    ]);
  });

  it('list reports the customised locales per type', async () => {
    const { service } = makeStrapi();
    await service.save('CANCELLATION', 'pt', VALID, 1);
    const list = await service.list();
    expect(list).toHaveLength(EMAIL_TEMPLATE_TYPES.length);
    expect(list.find((l) => l.type === 'CANCELLATION')?.customLocales).toEqual(['pt']);
    expect(list.find((l) => l.type === 'ORDER_CONFIRMATION')?.customLocales).toEqual([]);
  });

  it('restoreDefault removes the customization and keeps the previous version', async () => {
    const { service } = makeStrapi();
    await service.save('REFUND_STARTED', 'en', VALID, 1);
    await service.restoreDefault('REFUND_STARTED', 'en', 1);

    const t = await service.get('REFUND_STARTED', 'en');
    expect(t.isCustom).toBe(false);
    expect(t.html).toBe(DEFAULT_TEMPLATES.REFUND_STARTED.html);
    const versions = await service.listVersions('REFUND_STARTED', 'en');
    expect(versions[0]).toMatchObject({ version: 2, subject: VALID.subject, html: VALID.html });
    expect(t.version).toBe(3);
  });

  it('restoreVersion brings back an older version as a new one', async () => {
    const { service } = makeStrapi();
    await service.save('REFUND_STARTED', 'en', VALID, 1);
    await service.save('REFUND_STARTED', 'en', { ...VALID, subject: 'Other' }, 1);
    const versions = await service.listVersions('REFUND_STARTED', 'en');
    const v2 = versions.find((v) => v.version === 2)!;
    await service.restoreVersion('REFUND_STARTED', 'en', v2.id, 1);
    const t = await service.get('REFUND_STARTED', 'en');
    expect(t).toMatchObject({ isCustom: true, version: 4, subject: VALID.subject });
    await expect(service.restoreVersion('REFUND_STARTED', 'pt', v2.id, 1)).rejects.toBeInstanceOf(
      EcommerceNotFoundError
    );
  });

  it('render falls back from the locale to the default locale to the default template', async () => {
    const { service } = makeStrapi();
    const data = getSampleData('CANCELLATION');

    const fromDefault = await service.render('CANCELLATION', 'pt', data);
    expect(fromDefault.subject).toContain('LB-10042');
    expect(fromDefault.html).toContain('Acme');

    await service.save('CANCELLATION', 'en', { subject: 'EN {{order.reference}}', html: '<p>EN</p>' }, 1);
    expect((await service.render('CANCELLATION', 'pt', data)).subject).toBe('EN LB-10042');

    await service.save('CANCELLATION', 'pt', { subject: 'PT {{order.reference}}', html: '<p>PT</p>' }, 1);
    expect(await service.render('CANCELLATION', 'pt', data)).toEqual({
      subject: 'PT LB-10042',
      html: '<p>PT</p>',
    });
  });

  it('preview renders sample data with the real store data and reports issues', async () => {
    const { service } = makeStrapi();
    const ok = await service.preview('ORDER_CONFIRMATION', DEFAULT_TEMPLATES.ORDER_CONFIRMATION);
    expect(ok.issues).toEqual([]);
    expect(ok.html).toContain('Acme');
    expect(ok.html).toContain('#123456');
    expect(ok.html).toContain('Ceramic Mug');
    expect(ok.html).not.toContain('Littlebox Store');

    const bad = await service.preview('ORDER_CONFIRMATION', { subject: 'x', html: '{{#if order.total}}' });
    expect(bad.issues.map((i) => i.code)).toContain('SYNTAX');
    expect(bad.html).toBe('');
  });

  it('sendTest without an active Resend throws EMAIL_NOT_CONFIGURED', async () => {
    const none = makeStrapi();
    const err = await none.service.sendTest('ORDER_CONFIRMATION', 'en', 'me@example.com', 1).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceEmailError);
    expect(err.code).toBe('EMAIL_NOT_CONFIGURED');

    const inactive = makeStrapi({
      runtime: { config: { fromEmail: 'a@b.com' }, secrets: { apiKey: 'k' }, active: false },
    });
    const err2 = await inactive.service
      .sendTest('ORDER_CONFIRMATION', 'en', 'me@example.com', 1)
      .catch((e) => e);
    expect(err2.code).toBe('EMAIL_NOT_CONFIGURED');
  });

  it('sendTest sends the rendered sample through Resend and audits', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, tables } = makeStrapi({
      runtime: { config: { fromEmail: 'shop@acme.example', fromName: 'Acme' }, secrets: { apiKey: 'k' }, active: true },
    });
    await service.sendTest('PAYMENT_INSTRUCTIONS', 'en', 'me@example.com', 7);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
    expect(body.to).toEqual(['me@example.com']);
    expect(body.subject).toContain('LB-10042');
    expect(body.html).toContain('Acme');
    expect(tables[UIDS.auditLog]).toEqual([
      expect.objectContaining({ action: 'email_template.send_test', userId: '7' }),
    ]);
  });
});
