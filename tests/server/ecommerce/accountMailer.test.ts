import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn(async (..._a: any[]) => ({ id: 'e1' }));
vi.mock('../../../server/src/services/modules/ecommerce/providers/email/resendSender', () => ({
  sendWithResend: (...a: any[]) => send(...a),
}));

import EcommerceAccountMailer from '../../../server/src/services/modules/ecommerce/accountMailer';
import EcommerceEmailTemplateService from '../../../server/src/services/modules/ecommerce/email/templates';
import { STORE_SETTINGS_DEFAULTS } from '../../../server/src/services/modules/ecommerce/settings';
import { EcommerceEmailError } from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = { emailTemplate: `${P}email-template`, emailTemplateVersion: `${P}email-template-version` };

const make = (active = true, storefrontUrl: string | null = 'https://acme.example/') => {
  const db = createFakeDb(Object.values(UIDS));
  const settings = {
    getStoreSettings: vi.fn(async () => ({
      ...STORE_SETTINGS_DEFAULTS,
      storeName: 'Acme',
      storefrontUrl,
    })),
    getRuntime: vi.fn(async () => (active ? { active: true, apiKey: 'k' } : null)),
  };
  let templates: any;
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : {
            service: (n: string) =>
              n === 'EcommerceSettingsService' ? settings : n === 'EcommerceEmailTemplateService' ? templates : undefined,
          },
  };
  templates = EcommerceEmailTemplateService({ strapi });
  return EcommerceAccountMailer({ strapi });
};
/** The engine escapes `=` as `&#61;` in html; a mail client decodes it back. */
const lastMsg = () => {
  const m = send.mock.calls[send.mock.calls.length - 1][1];
  return { ...m, html: String(m.html).replace(/&#61;/g, '=') };
};

describe('EcommerceAccountMailer', () => {
  beforeEach(() => send.mockClear());

  it('a missing or blank storefront URL throws EMAIL_NOT_CONFIGURED and sends nothing', async () => {
    for (const url of [null, '   ']) {
      const m = make(true, url);
      await expect(m.sendAccountVerification('a@x.pt', 'en', { firstName: 'Ana', raw: 'R' })).rejects.toBeInstanceOf(
        EcommerceEmailError
      );
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('verification: link in the html, to, idempotency key without the raw token', async () => {
    const m = make();
    await m.sendAccountVerification('a@x.pt', 'en', { firstName: 'Ana', raw: 'RAW+TOKEN' });
    const msg = lastMsg();
    expect(msg.to).toBe('a@x.pt');
    expect(msg.html).toContain('https://acme.example/account/verify-email?token=RAW%2BTOKEN');
    expect(msg.html).toContain('If you did not create this account, ignore this e-mail');
    expect(msg.html).toContain('24');
    expect(msg.idempotencyKey).toBeTruthy();
    expect(msg.idempotencyKey).not.toContain('RAW');
  });

  it('verification in pt uses the Portuguese default', async () => {
    await make().sendAccountVerification('a@x.pt', 'pt', { firstName: 'Ana', raw: 'T' });
    expect(lastMsg().html).toContain('Se não criou esta conta, ignore este email');
  });

  it('a null locale falls back to the default locale', async () => {
    await make().sendPasswordReset('a@x.pt', null, { firstName: 'Ana', raw: 'T' });
    expect(lastMsg().html).toContain('https://acme.example/account/reset-password?token=T');
    expect(lastMsg().html).toContain('60');
  });

  it('email change verification goes to the given address with the new e-mail', async () => {
    await make().sendEmailChangeVerification('new@x.pt', 'en', { firstName: 'Ana', newEmail: 'new@x.pt', raw: 'T' });
    expect(lastMsg().to).toBe('new@x.pt');
    expect(lastMsg().html).toContain('https://acme.example/account/confirm-email?token=T');
    expect(lastMsg().html).toContain('new@x.pt');
  });

  it('email changed shows the masked new address only', async () => {
    await make().sendEmailChanged('old@x.pt', 'en', { firstName: 'Ana', newEmail: 'filipe@y.pt' });
    expect(lastMsg().html).toContain('f*****@y.pt');
    expect(lastMsg().html).not.toContain('filipe@y.pt');
  });

  it('registration attempt links to login and a token-less reset page', async () => {
    await make().sendRegistrationAttempt('a@x.pt', 'en', { firstName: 'Ana' });
    expect(lastMsg().html).toContain('https://acme.example/account/reset-password');
    expect(lastMsg().html).not.toContain('token=');
  });

  it('password changed sends a notice', async () => {
    await make().sendPasswordChanged('a@x.pt', 'en', { firstName: 'Ana' });
    expect(lastMsg().to).toBe('a@x.pt');
  });

  it('throws EMAIL_NOT_CONFIGURED when Resend is inactive and sends nothing', async () => {
    const err = await make(false).sendPasswordChanged('a@x.pt', 'en', { firstName: 'Ana' }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceEmailError);
    expect(err.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(send).not.toHaveBeenCalled();
  });
});
