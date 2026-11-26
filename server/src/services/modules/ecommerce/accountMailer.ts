import type { Core } from '@strapi/strapi';
import { createHash, randomUUID } from 'node:crypto';
import { PLUGIN_ID } from '../../../config';
import { EcommerceEmailError } from './errors';
import { sendWithResend } from './providers/email/resendSender';
import { buildAccountLink, maskEmail } from './domain/accounts/links';
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

  const send = async (
    type: EmailTemplateType,
    to: string,
    locale: string | null,
    firstName: string,
    build: (store: StoreSettings, resolvedLocale: string) => Record<string, unknown>,
    keySeed: string
  ): Promise<void> => {
    const rt = await settings().getRuntime('resend');
    if (!rt || !rt.active) {
      throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not active.');
    }
    const store = await settings().getStoreSettings();
    const resolved = locale ?? (await strapi.plugin('i18n').service('locales').getDefaultLocale());
    const message = await templates().render(type, resolved, {
      customer: { firstName },
      ...build(store, resolved),
    });
    await sendWithResend(rt, {
      to,
      subject: message.subject,
      html: message.html,
      idempotencyKey: `account:${type}:${createHash('sha256').update(`${type}:${keySeed}`).digest('hex')}`,
    });
  };

  const linkBase = (store: StoreSettings): string => {
    if (!store.storefrontUrl) {
      throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'The storefront URL is not set.');
    }
    return store.storefrontUrl;
  };

  return {
    async sendAccountVerification(
      to: string,
      locale: string | null,
      data: { firstName: string; raw: string }
    ): Promise<void> {
      await send('ACCOUNT_VERIFICATION', to, locale, data.firstName, (s) => ({
        verificationUrl: buildAccountLink(linkBase(s), s.accountPaths.verifyEmail, data.raw),
        expiresInHours: HOURS(TOKEN_TTL_MS.VERIFY_EMAIL),
      }), data.raw);
    },

    async sendPasswordReset(
      to: string,
      locale: string | null,
      data: { firstName: string; raw: string }
    ): Promise<void> {
      await send('PASSWORD_RESET', to, locale, data.firstName, (s) => ({
        resetUrl: buildAccountLink(linkBase(s), s.accountPaths.resetPassword, data.raw),
        expiresInMinutes: MINUTES(TOKEN_TTL_MS.RESET_PASSWORD),
      }), data.raw);
    },

    async sendPasswordChanged(
      to: string,
      locale: string | null,
      data: { firstName: string }
    ): Promise<void> {
      await send('PASSWORD_CHANGED', to, locale, data.firstName, (_s, l) => ({ changedAt: changedAt(l) }), randomUUID());
    },

    async sendEmailChangeVerification(
      to: string,
      locale: string | null,
      data: { firstName: string; newEmail: string; raw: string }
    ): Promise<void> {
      await send('EMAIL_CHANGE_VERIFICATION', to, locale, data.firstName, (s) => ({
        confirmationUrl: buildAccountLink(linkBase(s), s.accountPaths.confirmEmail, data.raw),
        newEmail: data.newEmail,
        expiresInHours: HOURS(TOKEN_TTL_MS.CHANGE_EMAIL),
      }), data.raw);
    },

    async sendEmailChanged(
      to: string,
      locale: string | null,
      data: { firstName: string; newEmail: string }
    ): Promise<void> {
      await send('EMAIL_CHANGED', to, locale, data.firstName, (_s, l) => ({
        newEmail: maskEmail(data.newEmail),
        changedAt: changedAt(l),
      }), randomUUID());
    },

    async sendRegistrationAttempt(
      to: string,
      locale: string | null,
      data: { firstName: string }
    ): Promise<void> {
      await send('REGISTRATION_ATTEMPT', to, locale, data.firstName, (s) => {
        const base = linkBase(s).replace(/\/+$/, '');
        const path = s.accountPaths.resetPassword;
        return { loginUrl: s.storefrontUrl, resetUrl: `${base}${path.startsWith('/') ? path : `/${path}`}` };
      }, randomUUID());
    },
  };
};

export default EcommerceAccountMailer;
