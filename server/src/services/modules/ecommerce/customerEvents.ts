import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  CLIENT_IP_HEADER,
  CLIENT_USER_AGENT_HEADER,
  clientIpFrom,
  sanitizeSearchTerm,
} from './domain/storefront/request';
import { truncateUserAgent } from './domain/accounts/clientInfo';

export const CUSTOMER_EVENT_TYPES = [
  'ACCOUNT_REGISTERED',
  'EMAIL_VERIFIED',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_REVOKED',
  'ORDER_PLACED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'PROFILE_UPDATED',
  'EMAIL_CHANGE_REQUESTED',
  'EMAIL_CHANGED',
  'BLOCKED',
  'UNBLOCKED',
] as const;

export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number];
export type LoginFailureReason = 'INVALID_PASSWORD' | 'EMAIL_NOT_VERIFIED' | 'BLOCKED' | 'NOT_REGISTERED';

/**
 * Who acted. `CUSTOMER`: proven by a login session or a link sent to the customer's e-mail.
 * `ANONYMOUS`: a storefront request nobody proved (failed login, reset request, registration,
 * guest checkout): it is stored without a name, so an attacker is never shown as the customer.
 */
export type EventActor =
  | { type: 'CUSTOMER' }
  | { type: 'ANONYMOUS' }
  | { type: 'ADMIN'; userId: number }
  | { type: 'SYSTEM' };

export type FieldChange = { field: string; from: string | null; to: string | null };

export type CustomerEventDetails = {
  reason?: LoginFailureReason;
  scope?: 'ONE' | 'OTHERS';
  orderId?: number;
  reference?: number;
  newEmail?: string;
  note?: string | null;
  changes?: FieldChange[];
};

export type CustomerEventView = {
  id: number;
  type: CustomerEventType;
  createdAt: string | null;
  actor: { type: EventActor['type']; id: number | null; name: string | null };
  ip: string | null;
  userAgent: string | null;
  details: CustomerEventDetails;
};

export const EVENTS_PAGE_SIZE = 50;
const SEARCH_TEXT_MAX = 4000;
const LOG_PREFIX = '[ecommerce:customer-events]';

/**
 * `user:5` (admin routes) → that admin; anything else (`storefront`, `system:*`) → the customer
 * for storefront actors, the system otherwise.
 */
export function actorFromString(actor: string | undefined | null): EventActor {
  const m = typeof actor === 'string' ? /^user:(\d+)$/.exec(actor) : null;
  if (m) return { type: 'ADMIN', userId: Number(m[1]) };
  return actor === 'storefront' ? { type: 'CUSTOMER' } : { type: 'SYSTEM' };
}

/** The changed fields between two records, as strings (null for empty). */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[]
): FieldChange[] {
  const norm = (v: unknown): string | null =>
    v === undefined || v === null || v === '' ? null : String(v);
  return fields
    .filter((f) => f in after && norm(before[f]) !== norm(after[f]))
    .map((f) => ({ field: f, from: norm(before[f]), to: norm(after[f]) }));
}

/** The lowercased text the free search matches (never a secret: details hold none). */
export function buildSearchText(parts: {
  type: string;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  details: CustomerEventDetails;
}): string {
  const d = parts.details;
  const words = [
    parts.type,
    parts.actorName,
    parts.ip,
    parts.userAgent,
    d.reason,
    d.scope,
    d.reference !== undefined ? `#${d.reference}` : null,
    d.newEmail,
    d.note,
    ...(d.changes ?? []).flatMap((c) => [c.field, c.from, c.to]),
  ];
  return words
    .filter((w): w is string => typeof w === 'string' && w !== '')
    .join(' ')
    .toLowerCase()
    .slice(0, SEARCH_TEXT_MAX);
}

const headerOf = (ctx: any, name: string): string => {
  const v = ctx?.request?.headers?.[name] ?? ctx?.request?.header?.[name];
  if (typeof v === 'string') return v;
  return Array.isArray(v) ? v.join(',') : '';
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The customer event log: what happened on a customer's account and who did it, shown in the
 * customer record. Writes never break the action that logs them (failures logged by error
 * name only); events are never edited or deleted through the API.
 */
const EcommerceCustomerEventService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const query = () => strapi.db.query(uids().customerEvent);

  /**
   * The client of the current request: the storefront's browser (headers set by the BFF) for a
   * customer, the admin's own request otherwise. Read synchronously, before any await.
   */
  const clientFor = (actor: EventActor): { ip: string | null; userAgent: string | null } => {
    let ctx: any;
    try {
      ctx = (strapi as any).requestContext?.get?.();
    } catch {
      ctx = undefined;
    }
    if (!ctx) return { ip: null, userAgent: null };
    if (actor.type === 'CUSTOMER' || actor.type === 'ANONYMOUS') {
      return {
        ip: clientIpFrom(headerOf(ctx, CLIENT_IP_HEADER)),
        userAgent: truncateUserAgent(headerOf(ctx, CLIENT_USER_AGENT_HEADER)),
      };
    }
    const ip = typeof ctx.request?.ip === 'string' ? ctx.request.ip : null;
    return { ip: clientIpFrom(ip) ?? ip, userAgent: truncateUserAgent(headerOf(ctx, 'user-agent')) };
  };

  /** A snapshot of who acted; unknown (deleted admin, read failure) is null, never an error. */
  const actorName = async (customerId: number, actor: EventActor): Promise<string | null> => {
    try {
      return await readActorName(customerId, actor);
    } catch {
      return null;
    }
  };

  const readActorName = async (customerId: number, actor: EventActor): Promise<string | null> => {
    if (actor.type === 'ADMIN') {
      const u = await strapi.db
        .query('admin::user')
        .findOne({ where: { id: actor.userId }, select: ['firstname', 'lastname', 'username', 'email'] });
      if (!u) return null;
      return [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.username || u.email || null;
    }
    if (actor.type === 'CUSTOMER') {
      const c = await strapi.db
        .query(uids().customer)
        .findOne({ where: { id: customerId }, select: ['firstName', 'lastName', 'email'] });
      if (!c) return null;
      return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || null;
    }
    return null;
  };

  const write = async (
    customerId: number,
    type: CustomerEventType,
    actor: EventActor,
    client: { ip: string | null; userAgent: string | null },
    details: CustomerEventDetails
  ): Promise<void> => {
    const name = await actorName(customerId, actor);
    await query().create({
      data: {
        customerId,
        type,
        actorType: actor.type,
        actorId: actor.type === 'ADMIN' ? actor.userId : actor.type === 'CUSTOMER' ? customerId : null,
        actorName: name,
        ip: client.ip,
        userAgent: client.userAgent,
        details,
        searchText: buildSearchText({ type, actorName: name, ...client, details }),
      },
    });
  };

  const toView = (row: any): CustomerEventView => ({
    id: row.id,
    type: row.type,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : typeof row.createdAt === 'string'
          ? row.createdAt
          : null,
    actor: {
      type: ['CUSTOMER', 'ANONYMOUS', 'ADMIN', 'SYSTEM'].includes(row.actorType) ? row.actorType : 'SYSTEM',
      id: Number.isInteger(row.actorId) ? row.actorId : null,
      name: typeof row.actorName === 'string' && row.actorName ? row.actorName : null,
    },
    ip: typeof row.ip === 'string' && row.ip ? row.ip : null,
    userAgent: typeof row.userAgent === 'string' && row.userAgent ? row.userAgent : null,
    details: isRecord(row.details) ? (row.details as CustomerEventDetails) : {},
  });

  return {
    /**
     * Logs an event after the answer (fire and forget). The client is read now, from the
     * request being served; nothing is awaited by the caller.
     */
    record(
      customerId: number,
      type: CustomerEventType,
      opts: { actor: EventActor; details?: CustomerEventDetails }
    ): void {
      if (!Number.isInteger(customerId)) return;
      const client = clientFor(opts.actor);
      void Promise.resolve()
        .then(() => write(customerId, type, opts.actor, client, opts.details ?? {}))
        .catch((err: unknown) => {
          strapi.log.error(`${LOG_PREFIX} EVENT_WRITE_FAILED ${err instanceof Error ? err.name : typeof err}`);
        });
    },

    /** The customer's events, newest first, 50 per page; `type` and a free `search` narrow them. */
    async list(
      customerId: number,
      opts: { page?: unknown; search?: unknown; type?: unknown } = {}
    ): Promise<{
      results: CustomerEventView[];
      pagination: { page: number; pageSize: number; total: number; pageCount: number };
    }> {
      const n = Math.floor(Number(opts.page));
      const page = Number.isFinite(n) && n >= 1 ? n : 1;
      const where: Record<string, unknown> = { customerId };
      if (typeof opts.type === 'string' && (CUSTOMER_EVENT_TYPES as readonly string[]).includes(opts.type)) {
        where.type = opts.type;
      }
      const term = sanitizeSearchTerm(opts.search).toLowerCase();
      if (term) where.searchText = { $containsi: term };
      const [total, rows] = await Promise.all([
        query().count({ where }),
        query().findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          offset: (page - 1) * EVENTS_PAGE_SIZE,
          limit: EVENTS_PAGE_SIZE,
        }),
      ]);
      return {
        results: rows.map(toView),
        pagination: {
          page,
          pageSize: EVENTS_PAGE_SIZE,
          total,
          pageCount: Math.ceil(total / EVENTS_PAGE_SIZE),
        },
      };
    },
  };
};

export default EcommerceCustomerEventService;
