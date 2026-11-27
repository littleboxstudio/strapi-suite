import type { Core } from '@strapi/strapi';
import { createHash, randomUUID } from 'node:crypto';
import { PLUGIN_ID } from '../../../config';
import { EcommerceEmailError } from './errors';
import { sendWithResend } from './providers/email/resendSender';
import { maskEmail } from './domain/accounts/links';
import { TOKEN_TTL_MS } from './customerTokens';
import type { EmailTemplateType } from './email/catalog';
import type { StoreSettings } from './settings';
import type { ProviderRuntime } from './providers/registry';

type SettingsApi = {
  getStoreSettings(): Promise<StoreSettings>;
  getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
};

const HOURS = (ms: number) => String(Math.round(ms / 3_600_000));
const MINUTES = (ms: number) => String(Math.round(ms / 60_000));

/** Sends the customer-account e-mails. Neither links nor tokens nor addresses are ever logged. */
const EcommerceAccountMailer = ({ strapi }: { strapi: Core.Strapi }) => {
  const settings = (): SettingsApi => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');
  const templates = () => strapi.plugin(PLUGIN_ID).service('EcommerceEmailTemplateService');

  const changedAt = (locale: string): string =>
    `${new Date().toLocaleString(/^pt/i.test(locale) ? 'pt-PT' : 'en-GB', {
      timeZone: 'UTC',
      dateStyle: 'short',
      timeStyle: 'short',
    })} UTC`;

  /** The links are written in the templates on top of `store.url`: without it they would be broken. */
  const requireStorefront = (store: StoreSettings): void => {
    const url = typeof store.storefrontUrl === 'string' ? store.storefrontUrl.trim() : '';
    if (!url) {
      throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'The storefront URL is not set.');
    }
  };

  const send = async (
    type: EmailTemplateType,
    to: string,
    locale: string | null,
    firstName: string,
    build: (resolvedLocale: string) => Record<string, unknown>,
    keySeed: string,
    links = false
  ): Promise<void> => {
    const rt = await settings().getRuntime('resend');
    if (!rt || !rt.active) {
      throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not active.');
    }
    const store = await settings().getStoreSettings();
    if (links) requireStorefront(store);
    const resolved = locale ?? (await strapi.plugin('i18n').service('locales').getDefaultLocale());
    const message = await templates().render(type, resolved, {
      customer: { firstName },
      ...build(resolved),
    });
    await sendWithResend(rt, {
      to,
      subject: message.subject,
      html: message.html,
      idempotencyKey: `account:${type}:${createHash('sha256').update(`${type}:${keySeed}`).digest('hex')}`,
    });
  };

  return {
    async sendAccountVerification(
      to: string,
      locale: string | null,
      data: { firstName: string; raw: string }
    ): Promise<void> {
      const vars = () => ({ token: encodeURIComponent(data.raw), expiresInHours: HOURS(TOKEN_TTL_MS.VERIFY_EMAIL) });
      await send('ACCOUNT_VERIFICATION', to, locale, data.firstName, vars, data.raw, true);
    },

    async sendPasswordReset(
      to: string,
      locale: string | null,
      data: { firstName: string; raw: string }
    ): Promise<void> {
      const vars = () => ({ token: encodeURIComponent(data.raw), expiresInMinutes: MINUTES(TOKEN_TTL_MS.RESET_PASSWORD) });
      await send('PASSWORD_RESET', to, locale, data.firstName, vars, data.raw, true);
    },

    async sendPasswordChanged(
      to: string,
      locale: string | null,
      data: { firstName: string }
    ): Promise<void> {
      await send('PASSWORD_CHANGED', to, locale, data.firstName, (l) => ({ changedAt: changedAt(l) }), randomUUID());
    },

    async sendEmailChangeVerification(
      to: string,
      locale: string | null,
      data: { firstName: string; newEmail: string; raw: string }
    ): Promise<void> {
      const vars = () => ({
        token: encodeURIComponent(data.raw),
        newEmail: data.newEmail,
        expiresInHours: HOURS(TOKEN_TTL_MS.CHANGE_EMAIL),
      });
      await send('EMAIL_CHANGE_VERIFICATION', to, locale, data.firstName, vars, data.raw, true);
    },

    async sendEmailChanged(
      to: string,
      locale: string | null,
      data: { firstName: string; newEmail: string }
    ): Promise<void> {
      const vars = (l: string) => ({ newEmail: maskEmail(data.newEmail), changedAt: changedAt(l) });
      await send('EMAIL_CHANGED', to, locale, data.firstName, vars, randomUUID());
    },

    async sendRegistrationAttempt(
      to: string,
      locale: string | null,
      data: { firstName: string }
    ): Promise<void> {
      await send('REGISTRATION_ATTEMPT', to, locale, data.firstName, () => ({}), randomUUID(), true);
    },
  };
};

export default EcommerceAccountMailer;
