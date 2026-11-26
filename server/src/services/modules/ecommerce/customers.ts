import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  EcommerceAccountError,
  EcommerceAccountsUnavailableError,
  EcommerceNotFoundError,
  EcommerceValidationError,
  type ValidationIssue,
} from './errors';
import { isEmail } from './settings';
import type { AuditEntry } from './audit';
import { normalizeEmail } from './domain/email';
import { findLocale, resolveLocale } from './locales';
import { checkPasswordPolicy } from './domain/accounts/passwordPolicy';

const AREA = 'customers';
const PAGE_SIZE = 50;
const LOG_PREFIX = '[ecommerce:customers]';
/** Longer passwords are refused before any hashing (denial-of-service guard). */
const PASSWORD_INPUT_MAX = 1024;
const BLOCK_NOTE_MAX = 1000;
const ACCOUNT_TYPES = ['GUEST', 'REGISTERED'];
type AdminUserRow = {
  id: number | string;
  firstname?: string | null;
  lastname?: string | null;
  username?: string | null;
  email?: string | null;
};

export const isValidEmail = (email: unknown): boolean =>
  typeof email === 'string' && isEmail(email.trim());

export type CustomerInput = { firstName: string; lastName: string; email: string; phone?: string | null };

/** The random-password hash of a new guest customer, computed before the order transaction. */
export type GuestPassword = { hash: string; pepperVersion: number };

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function validate(input: CustomerInput): { values: Required<CustomerInput>; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const firstName = clean(input?.firstName);
  const lastName = clean(input?.lastName);
  const email = clean(input?.email);
  const phone = clean(input?.phone);
  if (!firstName) errors.push({ path: 'firstName', code: 'required' });
  if (!lastName) errors.push({ path: 'lastName', code: 'required' });
  if (!email) errors.push({ path: 'email', code: 'required' });
  else if (!isValidEmail(email)) errors.push({ path: 'email', code: 'invalid_email' });
  return { values: { firstName, lastName, email, phone: phone || null }, errors };
}

const toPage = (page: unknown): number => {
  const n = Math.floor(Number(page));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

const EcommerceCustomerService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const audit = (entry: AuditEntry): Promise<void> =>
    strapi.plugin(PLUGIN_ID).service('EcommerceAuditService').log(entry);

  const svc = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);

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

  /** Admin user ids to display names (first and last name, else username); unknown ids are omitted. */
  const adminNames = async (ids: unknown[]): Promise<Map<number, string>> => {
    const unique = [...new Set(ids.filter((i): i is number => typeof i === 'number'))];
    const names = new Map<number, string>();
    if (!unique.length) return names;
    const users: AdminUserRow[] = await strapi.db.query('admin::user').findMany({
      where: { id: { $in: unique } },
      select: ['id', 'firstname', 'lastname', 'username'],
    });
    for (const u of users) {
      const name = [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.username;
      if (name) names.set(Number(u.id), name);
    }
    return names;
  };

  const accountFields = (c: any, names: Map<number, string>) => ({
    accountType: c.accountType === 'REGISTERED' ? 'REGISTERED' : 'GUEST',
    emailVerified: c.emailVerified === true,
    blocked: c.blocked === true,
    blockedAt: c.blocked === true ? (c.blockedAt ?? null) : null,
    blockedNote: c.blocked === true ? (c.blockedNote ?? null) : null,
    blockedBy: c.blocked === true && typeof c.blockedById === 'number' ? (names.get(c.blockedById) ?? null) : null,
  });

  const pagination = (page: number, total: number) => ({
    page,
    pageSize: PAGE_SIZE,
    total,
    pageCount: Math.ceil(total / PAGE_SIZE),
  });

  return {
    /**
     * Finds the oldest customer with this e-mail or creates one. Never updates an existing customer,
     * with one exception: a customer saved before customers had a locale (legacy row, no `locale`)
     * gets it once, from the first order that finds it. `opts.locale` (the order's language) is
     * checked against the i18n locales: an unknown or missing one saves the default locale.
     *
     * A blocked customer is refused (`CUSTOMER_BLOCKED`, compared by normalized e-mail). A new
     * customer is a `GUEST`, not verified, with `opts.guestPassword` (the hash of a random
     * password nobody knows) when the caller could compute one; without it the background fill
     * adds it later. Unused when an existing customer is found.
     */
    async findOrCreate(
      input: CustomerInput,
      opts: { locale?: unknown; guestPassword?: GuestPassword | null } = {}
    ): Promise<{ id: number; created: boolean }> {
      const { values, errors } = validate(input);
      if (errors.length) throw new EcommerceValidationError('Invalid customer', errors);
      const q = strapi.db.query(uids().customer);
      const emailNormalized = normalizeEmail(values.email);
      const [existing] = await q.findMany({ where: { emailNormalized }, orderBy: { id: 'asc' }, limit: 1 });
      if (existing) {
        if (existing.blocked === true) throw new EcommerceAccountError('CUSTOMER_BLOCKED', 403);
        if (!existing.locale) {
          const locale = await resolveLocale(strapi, opts.locale);
          await q.update({ where: { id: existing.id }, data: { locale } });
        }
        return { id: existing.id, created: false };
      }
      const locale = await resolveLocale(strapi, opts.locale);
      const guest = opts.guestPassword;
      const created = await q.create({
        data: {
          ...values,
          emailNormalized,
          locale,
          accountType: 'GUEST',
          emailVerified: false,
          blocked: false,
          ...(guest ? { passwordHash: guest.hash, passwordPepperVersion: guest.pepperVersion } : {}),
        },
      });
      return { id: created.id, created: true };
    },

    /**
     * The logged-in customer an order goes to (storefront with a login session): the account row
     * itself, never an e-mail lookup. A blocked one is refused (`CUSTOMER_BLOCKED`).
     */
    async accountForOrder(id: number): Promise<{ id: number; created: false }> {
      const row = await strapi.db
        .query(uids().customer)
        .findOne({ where: { id }, select: ['id', 'blocked'] });
      if (!row) throw new EcommerceValidationError('Invalid customer', [{ path: 'customer', code: 'customer_not_found' }]);
      if (row.blocked === true) throw new EcommerceAccountError('CUSTOMER_BLOCKED', 403);
      return { id: row.id, created: false };
    },

    /** True when a blocked customer has this e-mail (compared normalized). */
    async isBlockedEmail(email: string): Promise<boolean> {
      const emailNormalized = normalizeEmail(typeof email === 'string' ? email : '');
      if (!emailNormalized) return false;
      const row = await strapi.db
        .query(uids().customer)
        .findOne({ where: { emailNormalized, blocked: true }, select: ['id'] });
      return !!row;
    },

    async list(
      {
        page,
        search,
        accountType,
        blocked,
      }: { page?: number; search?: string; accountType?: string; blocked?: boolean } = {}
    ) {
      const q = strapi.db.query(uids().customer);
      const p = toPage(page);
      const term = normalizeEmail(search ?? '');
      const where: Record<string, unknown> = term ? { emailNormalized: { $containsi: term } } : {};
      if (typeof accountType === 'string' && ACCOUNT_TYPES.includes(accountType)) where.accountType = accountType;
      if (blocked === true) where.blocked = true;
      else if (blocked === false) where.blocked = { $ne: true };
      const [total, rows] = await Promise.all([
        q.count({ where }),
        q.findMany({
          where,
          orderBy: { id: 'desc' },
          offset: (p - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          // Orders ids only; the count comes from the same query (no extra round trip).
          populate: { orders: { select: ['id'] } },
        }),
      ]);
      const names = await adminNames(rows.map((c: any) => c.blockedById));
      return {
        results: rows.map((c: any) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          locale: c.locale ?? null,
          ...accountFields(c, names),
          ordersCount: Array.isArray(c.orders) ? c.orders.length : 0,
        })),
        pagination: pagination(p, total),
      };
    },

    async get(id: number) {
      const c = await strapi.db.query(uids().customer).findOne({ where: { id } });
      if (!c) throw new EcommerceNotFoundError('Customer not found');
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone ?? null,
        locale: c.locale ?? null,
        ...accountFields(c, await adminNames([c.blockedById])),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    },

    async update(id: number, input: CustomerInput, actor?: string) {
      const q = strapi.db.query(uids().customer);
      const current = await q.findOne({ where: { id } });
      if (!current) throw new EcommerceNotFoundError('Customer not found');

      const { values, errors } = validate(input);
      const emailNormalized = normalizeEmail(values.email);
      const emailChanged = !errors.length && emailNormalized !== (current.emailNormalized ?? normalizeEmail(current.email ?? ''));
      // The language is optional here: absent keeps the current one; present must be a locale the
      // backend has (stored with its own case), never silently replaced by the default.
      const wantedLocale = (input as { locale?: unknown })?.locale;
      const locale = wantedLocale === undefined ? undefined : await findLocale(strapi, wantedLocale);
      if (wantedLocale !== undefined && !locale) errors.push({ path: 'locale', code: 'invalid_locale' });
      if (errors.length) throw new EcommerceValidationError('Invalid customer', errors);

      const changedFields = [
        ...(['firstName', 'lastName', 'email', 'phone'] as const).filter(
          (f) => (current[f] ?? null) !== values[f]
        ),
        ...(locale && locale !== current.locale ? (['locale'] as const) : []),
      ];
      // An account's new e-mail is unproven: unverified, old sessions gone, and the credits and
      // promotion usage keyed by the old e-mail move with it.
      const reverify = emailChanged && current.accountType === 'REGISTERED';
      const taken = () =>
        new EcommerceValidationError('Invalid customer', [{ path: 'email', code: 'taken' }]);
      await strapi.db.transaction(async () => {
        if (emailChanged) {
          // Re-checked in the transaction that writes it (the e-mail has no unique index).
          const [owner] = await q.findMany({ where: { emailNormalized, id: { $ne: id } }, select: ['id'], limit: 1 });
          if (owner) throw taken();
          const [pending] = await q.findMany({
            where: { pendingEmailNormalized: emailNormalized, id: { $ne: id } },
            select: ['id'],
            limit: 1,
          });
          if (pending) throw taken();
        }
        await q.update({
          where: { id },
          data: {
            ...values,
            emailNormalized,
            ...(locale ? { locale } : {}),
            ...(reverify
              ? { emailVerified: false, emailVerifiedAt: null, pendingEmail: null, pendingEmailNormalized: null }
              : {}),
          },
        });
        if (reverify) {
          const oldNormalized = String(current.emailNormalized ?? '');
          await svc('EcommerceStoreCreditService').rekeyCustomerEmail(oldNormalized, emailNormalized);
          await svc('EcommercePromotionService').rekeyCustomerEmail(oldNormalized, emailNormalized);
        }
      });
      if (reverify) {
        await svc('EcommerceCustomerSessionService').revokeAll(id, 'EMAIL_CHANGED');
        fire(async () => {
          const { raw } = await svc('EcommerceCustomerTokenService').issue(id, 'VERIFY_EMAIL', values.email);
          await svc('EcommerceAccountMailer').sendAccountVerification(values.email, locale ?? current.locale ?? null, {
            firstName: values.firstName,
            raw,
          });
        });
      }
      if (changedFields.length) {
        await audit({
          area: AREA,
          action: 'customer.update',
          targetId: String(id),
          userId: actor,
          details: { changedFields },
        });
      }
      return this.get(id);
    },

    /** Blocks a customer: flags and note saved, every login session revoked. */
    async block(id: number, input: { note?: string | null } = {}, actor: { userId: number }) {
      const q = strapi.db.query(uids().customer);
      const current = await q.findOne({ where: { id }, select: ['id'] });
      if (!current) throw new EcommerceNotFoundError('Customer not found');
      const raw = input?.note;
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        throw new EcommerceValidationError('Invalid customer', [{ path: 'note', code: 'invalid' }]);
      }
      const note = typeof raw === 'string' ? raw.trim() : '';
      if (note.length > BLOCK_NOTE_MAX) {
        throw new EcommerceValidationError('Invalid customer', [{ path: 'note', code: 'too_long' }]);
      }
      await q.update({
        where: { id },
        data: { blocked: true, blockedAt: new Date(), blockedNote: note || null, blockedById: actor.userId },
      });
      await svc('EcommerceCustomerSessionService').revokeAll(id, 'BLOCKED');
      await audit({ area: AREA, action: 'customer.block', targetId: String(id), userId: `user:${actor.userId}` });
      return this.get(id);
    },

    /** Unblocks a customer and clears the note. Sessions stay revoked: the customer logs in again. */
    async unblock(id: number, actor: { userId: number }) {
      const q = strapi.db.query(uids().customer);
      const current = await q.findOne({ where: { id }, select: ['id'] });
      if (!current) throw new EcommerceNotFoundError('Customer not found');
      await q.update({
        where: { id },
        data: { blocked: false, blockedAt: null, blockedNote: null, blockedById: null },
      });
      await audit({ area: AREA, action: 'customer.unblock', targetId: String(id), userId: `user:${actor.userId}` });
      return this.get(id);
    },

    /** An admin sets a registered, unblocked customer's password; every session is revoked. */
    async setPassword(id: number, input: { password?: unknown }, actor: { userId: number }): Promise<void> {
      const q = strapi.db.query(uids().customer);
      const current = await q.findOne({ where: { id } });
      if (!current) throw new EcommerceNotFoundError('Customer not found');
      const issue = (code: string) =>
        new EcommerceValidationError('Invalid password', [{ path: 'password', code }]);
      if (current.accountType !== 'REGISTERED' || current.blocked === true) throw issue('not_allowed');
      const password = input?.password;
      if (typeof password === 'string' && password.length > PASSWORD_INPUT_MAX) throw issue('TOO_LONG');
      const policy = checkPasswordPolicy(password, String(current.email ?? ''));
      if (policy.ok === false) throw issue(policy.reason);
      const passwords = svc('EcommercePasswordService');
      if (!passwords.available()) throw new EcommerceAccountsUnavailableError();
      const { hash, pepperVersion } = await passwords.hash(password as string);
      await q.update({
        where: { id },
        data: { passwordHash: hash, passwordPepperVersion: pepperVersion, passwordChangedAt: new Date() },
      });
      await svc('EcommerceCustomerSessionService').revokeAll(id, 'ADMIN_PASSWORD');
      await audit({ area: AREA, action: 'customer.password_set', targetId: String(id), userId: `user:${actor.userId}` });
      fire(() =>
        svc('EcommerceAccountMailer').sendPasswordChanged(String(current.email), current.locale ?? null, {
          firstName: String(current.firstName ?? ''),
        })
      );
    },

    /** Order history; `search` is an order reference (`1001` or `#1001`), anything else matches nothing. */
    async listOrders(customerId: number, { page, search }: { page?: number; search?: string } = {}) {
      const q = strapi.db.query(uids().order);
      const p = toPage(page);
      const where: Record<string, unknown> = { customer: { id: customerId } };
      const term = String(search ?? '').trim().replace(/^#/, '');
      if (term) {
        if (!/^\d+$/.test(term) || !Number.isSafeInteger(Number(term))) {
          return { results: [], pagination: pagination(p, 0) };
        }
        where.reference = Number(term);
      }
      const [total, rows] = await Promise.all([
        q.count({ where }),
        q.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          offset: (p - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        }),
      ]);
      return {
        results: rows.map((o: any) => ({
          id: o.id,
          reference: o.reference,
          createdAt: o.createdAt,
          total: o.total,
          orderStatus: o.orderStatus,
          paymentStatus: o.paymentStatus,
          fulfillmentStatus: o.fulfillmentStatus,
        })),
        pagination: pagination(p, total),
      };
    },

    async lastOrderAddresses(customerId: number) {
      const [o] = await strapi.db.query(uids().order).findMany({
        where: { customer: { id: customerId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: 1,
      });
      if (!o) return null;
      // A DPD Pickup order delivers to the point: the customer's own address is the one to reuse.
      const customerAddress = o.pickupPoint?.customerAddress;
      return {
        shippingAddress: customerAddress && typeof customerAddress === 'object' ? customerAddress : (o.shippingAddress ?? null),
        billingAddress: o.billingAddress ?? null,
      };
    },
  };
};

export default EcommerceCustomerService;
