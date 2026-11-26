import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { mergeCarts } from './domain/accounts/cartMerge';
import { checkPasswordPolicy } from './domain/accounts/passwordPolicy';
import { isValidEmailFormat, normalizeEmail } from './domain/email';
import { MAX_EMAIL_LENGTH, MAX_LINE_QUANTITY } from './domain/storefront/limits';
import {
  EcommerceAccountError,
  EcommerceAccountsUnavailableError,
  EcommerceValidationError,
  type ValidationIssue,
} from './errors';
import { resolveLocale } from './locales';
import {
  readStoredCart,
  type CheckoutSession,
} from './storefrontSessions';

const LOG_PREFIX = '[ecommerce:accounts]';
/** Longer passwords are refused before any hashing (denial-of-service guard). */
const PASSWORD_INPUT_MAX = 1024;
const NAME_MAX = 100;
const PHONE_MAX = 40;

export type ClientInfo = { ip: string | null; userAgent: string | null };

export type AccountProfile = {
  id: number;
  email: string;
  pendingEmail: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  locale: string | null;
  createdAt: string | null;
};

export type LoginResult = { token: string; expiresAt: string; customer: AccountProfile };

export type RegisterInput = {
  email: unknown;
  password: unknown;
  firstName: unknown;
  lastName: unknown;
  phone?: unknown;
  locale?: unknown;
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isoOrNull = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

/** The e-mail as typed (trimmed), valid and within the length cap; null otherwise. */
const readEmail = (raw: unknown): string | null => {
  const email = clean(raw);
  return email !== '' && email.length <= MAX_EMAIL_LENGTH && isValidEmailFormat(email) ? email : null;
};

type CustomerRow = Record<string, any> & { id: number };

const EcommerceAccountService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uid = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce.customer;
  };
  const customers = () => strapi.db.query(uid());
  const svc = (name: string) => strapi.plugin(PLUGIN_ID).service(name);
  const passwords = () => svc('EcommercePasswordService');
  const tokens = () => svc('EcommerceCustomerTokenService');
  const sessions = () => svc('EcommerceCustomerSessionService');
  const checkout = () => svc('EcommerceStorefrontSessionService');
  const mailer = () => svc('EcommerceAccountMailer');

  /** Fire and forget: never awaited by the caller, failures logged as codes only. */
  const fire = (send: () => Promise<unknown>): void => {
    void Promise.resolve()
      .then(send)
      .catch((err: unknown) => {
        const e = err as { code?: unknown; name?: unknown };
        const code = typeof e?.code === 'string' ? e.code : 'EMAIL_SEND_FAILED';
        const name = typeof e?.name === 'string' ? e.name : 'Error';
        strapi.log.warn(`${LOG_PREFIX} ${code} ${name}`);
      });
  };

  const oldestByEmail = async (emailNormalized: string): Promise<CustomerRow | null> => {
    const [row] = await customers().findMany({
      where: { emailNormalized },
      orderBy: { id: 'asc' },
      limit: 1,
    });
    return row ?? null;
  };

  const profile = (c: CustomerRow): AccountProfile => ({
    id: c.id,
    email: String(c.email ?? ''),
    pendingEmail: typeof c.pendingEmail === 'string' && c.pendingEmail ? c.pendingEmail : null,
    firstName: String(c.firstName ?? ''),
    lastName: String(c.lastName ?? ''),
    phone: typeof c.phone === 'string' && c.phone ? c.phone : null,
    locale: typeof c.locale === 'string' && c.locale ? c.locale : null,
    createdAt: isoOrNull(c.createdAt),
  });

  const tokenInvalid = () => new EcommerceAccountError('TOKEN_INVALID', 400);
  const invalidCredentials = () => new EcommerceAccountError('INVALID_CREDENTIALS', 401);

  const weakPassword = (password: unknown, email: string): void => {
    if (typeof password === 'string' && password.length > PASSWORD_INPUT_MAX) {
      throw new EcommerceAccountError('WEAK_PASSWORD', 400, { reason: 'TOO_LONG' });
    }
    const policy = checkPasswordPolicy(password, email);
    if (policy.ok === false) throw new EcommerceAccountError('WEAK_PASSWORD', 400, { reason: policy.reason });
  };

  /** Merges the guest cart into the account's, opens the login session and retires the guest session. */
  const startSession = async (
    customer: CustomerRow,
    guest: CheckoutSession,
    client: ClientInfo
  ): Promise<LoginResult> => {
    const opened = await sessions().open(customer.id, client);
    const merged = mergeCarts(readStoredCart(customer.cart), readStoredCart(guest.cart), MAX_LINE_QUANTITY);
    await customers().update({ where: { id: customer.id }, data: { cart: merged } });
    await checkout().expireAndScrub(guest.id);
    return { token: opened.token, expiresAt: opened.expiresAt, customer: profile(customer) };
  };

  const sendVerification = async (customer: CustomerRow, localeFallback?: string): Promise<void> => {
    const { raw } = await tokens().issue(customer.id, 'VERIFY_EMAIL', String(customer.email));
    const locale = customer.locale ?? localeFallback ?? null;
    fire(() =>
      mailer().sendAccountVerification(String(customer.email), locale, {
        firstName: String(customer.firstName ?? ''),
        raw,
      })
    );
  };

  return {
    /**
     * Always one password hash, so every branch costs the same. The caller answers 202 whatever
     * the e-mail's state; mails go out after the writes and never delay the answer.
     */
    async register(input: RegisterInput): Promise<void> {
      const errors: ValidationIssue[] = [];
      const email = readEmail(input?.email);
      const firstName = clean(input?.firstName);
      const lastName = clean(input?.lastName);
      const phone = clean(input?.phone);
      if (!email) errors.push({ path: 'email', code: 'invalid_email' });
      if (!firstName || firstName.length > NAME_MAX) errors.push({ path: 'firstName', code: 'required' });
      if (!lastName || lastName.length > NAME_MAX) errors.push({ path: 'lastName', code: 'required' });
      if (phone.length > PHONE_MAX) errors.push({ path: 'phone', code: 'invalid' });
      if (errors.length || !email) throw new EcommerceValidationError('Invalid registration', errors);
      weakPassword(input.password, email);

      const emailNormalized = normalizeEmail(email);
      const password = input.password as string;
      const { hash, pepperVersion } = await passwords().hash(password);
      const credentials = {
        passwordHash: hash,
        passwordPepperVersion: pepperVersion,
        passwordChangedAt: new Date(),
      };

      let existing = await oldestByEmail(emailNormalized);
      if (!existing) {
        const locale = await resolveLocale(strapi, input.locale);
        const created = (await customers().create({
          data: {
            email,
            emailNormalized,
            firstName,
            lastName,
            phone: phone || null,
            locale,
            accountType: 'REGISTERED',
            emailVerified: false,
            blocked: false,
            ...credentials,
          },
        })) as CustomerRow;
        const oldest = await oldestByEmail(emailNormalized);
        if (!oldest || oldest.id === created.id) {
          await sendVerification(created);
          return;
        }
        // Lost a race against a concurrent registration: keep the oldest row.
        await customers().delete({ where: { id: created.id } });
        existing = oldest;
      }

      if (existing.blocked === true) return;
      if (existing.accountType === 'REGISTERED' && existing.emailVerified === true) {
        const row = existing;
        fire(() =>
          mailer().sendRegistrationAttempt(String(row.email), row.locale ?? null, {
            firstName: String(row.firstName ?? ''),
          })
        );
        return;
      }
      // A guest account (its orders stay on the row) or a registered, unverified one.
      const locale = input.locale === undefined ? undefined : await resolveLocale(strapi, input.locale);
      await customers().update({
        where: { id: existing.id },
        data: {
          firstName,
          lastName,
          phone: phone || null,
          ...(locale ? { locale } : {}),
          accountType: 'REGISTERED',
          emailVerified: false,
          emailVerifiedAt: null,
          ...credentials,
        },
      });
      await sendVerification({ ...existing, firstName, lastName, ...(locale ? { locale } : {}) });
    },

    async verifyEmail(token: unknown, guest: CheckoutSession, client: ClientInfo): Promise<LoginResult> {
      const consumed = await tokens().consume(token, 'VERIFY_EMAIL');
      if (!consumed) throw tokenInvalid();
      const customer: CustomerRow | null = await customers().findOne({ where: { id: consumed.customerId } });
      if (
        !customer ||
        customer.blocked === true ||
        customer.accountType !== 'REGISTERED' ||
        normalizeEmail(consumed.email) !== customer.emailNormalized
      ) {
        throw tokenInvalid();
      }
      const verifiedAt = new Date();
      await customers().update({
        where: { id: customer.id },
        data: { emailVerified: true, emailVerifiedAt: verifiedAt },
      });
      return startSession({ ...customer, emailVerified: true, emailVerifiedAt: verifiedAt }, guest, client);
    },

    /** Silent for every input; sends only for a registered, unverified, unblocked account. */
    async resendVerification(email: unknown): Promise<void> {
      const valid = readEmail(email);
      if (!valid) return;
      const customer = await oldestByEmail(normalizeEmail(valid));
      if (
        !customer ||
        customer.blocked === true ||
        customer.accountType !== 'REGISTERED' ||
        customer.emailVerified === true
      ) {
        return;
      }
      await sendVerification(customer);
    },

    async login(
      input: { email: unknown; password: unknown },
      guest: CheckoutSession,
      client: ClientInfo
    ): Promise<LoginResult> {
      const email = readEmail(input?.email);
      const password = input?.password;
      if (!email || typeof password !== 'string' || password.length > PASSWORD_INPUT_MAX) {
        throw invalidCredentials();
      }
      const customer = await oldestByEmail(normalizeEmail(email));
      const usable = customer && customer.accountType === 'REGISTERED' && customer.blocked !== true;
      // One verification whatever the account (a dummy one when there is nothing to check).
      const check = await passwords().verify(
        usable
          ? { hash: customer.passwordHash ?? null, pepperVersion: customer.passwordPepperVersion ?? null }
          : null,
        password
      );
      if (!usable || !check.ok) throw invalidCredentials();
      if (check.rehash) {
        await customers().update({
          where: { id: customer.id },
          data: { passwordHash: check.rehash.hash, passwordPepperVersion: check.rehash.pepperVersion },
        });
      }
      if (customer.emailVerified !== true) throw new EcommerceAccountError('EMAIL_NOT_VERIFIED', 403);
      return startSession(customer, guest, client);
    },

    async logout(customerId: number, sessionId: number): Promise<void> {
      // Already revoked (false) is not an error: logging out twice is fine.
      await sessions().revoke(customerId, sessionId, 'LOGOUT');
    },

    /** Silent for every input; sends only for a registered, unblocked account (verified or not). */
    async forgotPassword(email: unknown): Promise<void> {
      const valid = readEmail(email);
      if (!valid) return;
      const customer = await oldestByEmail(normalizeEmail(valid));
      if (!customer || customer.blocked === true || customer.accountType !== 'REGISTERED') return;
      const { raw } = await tokens().issue(customer.id, 'RESET_PASSWORD', String(customer.email));
      fire(() =>
        mailer().sendPasswordReset(String(customer.email), customer.locale ?? null, {
          firstName: String(customer.firstName ?? ''),
          raw,
        })
      );
    },

    async resetPassword(input: { token: unknown; password: unknown }): Promise<void> {
      // Checked before the token is consumed, so a weak password does not burn the link.
      weakPassword(input?.password, '');
      if (!passwords().available()) throw new EcommerceAccountsUnavailableError();
      const consumed = await tokens().consume(input.token, 'RESET_PASSWORD');
      if (!consumed) throw tokenInvalid();
      const customer: CustomerRow | null = await customers().findOne({ where: { id: consumed.customerId } });
      if (
        !customer ||
        customer.blocked === true ||
        customer.accountType !== 'REGISTERED' ||
        normalizeEmail(consumed.email) !== customer.emailNormalized
      ) {
        throw tokenInvalid();
      }
      // The e-mail is only known now (a password equal to it is the one case left to check).
      weakPassword(input.password, String(customer.email));
      const { hash, pepperVersion } = await passwords().hash(input.password as string);
      const now = new Date();
      await customers().update({
        where: { id: customer.id },
        data: {
          passwordHash: hash,
          passwordPepperVersion: pepperVersion,
          passwordChangedAt: now,
          emailVerified: true,
          ...(customer.emailVerified === true ? {} : { emailVerifiedAt: now }),
        },
      });
      await sessions().revokeAll(customer.id, 'PASSWORD_RESET');
      fire(() =>
        mailer().sendPasswordChanged(String(customer.email), customer.locale ?? null, {
          firstName: String(customer.firstName ?? ''),
        })
      );
    },
  };
};

export default EcommerceAccountService;
