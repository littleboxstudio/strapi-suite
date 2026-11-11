import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError, type ValidationIssue } from './errors';
import { isEmail } from './settings';
import type { AuditEntry } from './audit';

const AREA = 'customers';
const PAGE_SIZE = 50;

export const normalizeEmail = (email: string): string => String(email ?? '').trim().toLowerCase();
export const isValidEmail = (email: unknown): boolean =>
  typeof email === 'string' && isEmail(email.trim());

export type CustomerInput = { firstName: string; lastName: string; email: string; phone?: string | null };

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
    normalizeEmail,
    isValidEmail,

    /** Finds the oldest customer with this e-mail or creates one. Never updates an existing customer. */
    async findOrCreate(input: CustomerInput): Promise<{ id: number; created: boolean }> {
      const { values, errors } = validate(input);
      if (errors.length) throw new EcommerceValidationError('Invalid customer', errors);
      const q = strapi.db.query(uids().customer);
      const emailNormalized = normalizeEmail(values.email);
      const [existing] = await q.findMany({ where: { emailNormalized }, orderBy: { id: 'asc' }, limit: 1 });
      if (existing) return { id: existing.id, created: false };
      const created = await q.create({ data: { ...values, emailNormalized } });
      return { id: created.id, created: true };
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
      if (errors.length) throw new EcommerceValidationError('Invalid customer', errors);

      const changedFields = (['firstName', 'lastName', 'email', 'phone'] as const).filter(
        (f) => (current[f] ?? null) !== values[f]
      );
      await q.update({ where: { id }, data: { ...values, emailNormalized } });
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
      return { shippingAddress: o.shippingAddress ?? null, billingAddress: o.billingAddress ?? null };
    },
  };
};

export default EcommerceCustomerService;
