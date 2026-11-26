import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  EcommerceAccountError,
  EcommerceNotFoundError,
  EcommerceValidationError,
  type ValidationIssue,
} from './errors';
import { isEmail } from './settings';
import type { AuditEntry } from './audit';
import { normalizeEmail } from './domain/email';
import { findLocale, resolveLocale } from './locales';

const AREA = 'customers';
const PAGE_SIZE = 50;

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

    async list({ page, search }: { page?: number; search?: string } = {}) {
      const q = strapi.db.query(uids().customer);
      const p = toPage(page);
      const term = normalizeEmail(search ?? '');
      const where = term ? { emailNormalized: { $containsi: term } } : {};
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
      return {
        results: rows.map((c: any) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          locale: c.locale ?? null,
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
      if (!errors.length) {
        const clash = await q.findOne({ where: { emailNormalized, id: { $ne: id } } });
        if (clash) errors.push({ path: 'email', code: 'duplicate_email' });
      }
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
      await q.update({
        where: { id },
        data: { ...values, emailNormalized, ...(locale ? { locale } : {}) },
      });
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
