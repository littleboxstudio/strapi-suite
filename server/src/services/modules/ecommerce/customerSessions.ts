import type { Core } from '@strapi/strapi';
import { hkdfSync } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { ipPrefix, truncateUserAgent } from './domain/accounts/clientInfo';
import { EcommerceAccountsUnavailableError } from './errors';
import { isRecord } from './orderPricingHelpers';
import { resolveEncryptionKeySource } from './secrets';

const ISSUER = 'ltb-ecommerce';
const AUDIENCE = 'ltb-storefront';
const HKDF_INFO = 'ltb-ecommerce-customer-jwt-v1';
const DAY_MS = 86_400_000;
/** A session dies after this long without use. */
export const SESSION_IDLE_MS = 30 * DAY_MS;
/** A session dies this long after it was opened, whatever its use. */
export const SESSION_ABSOLUTE_MS = 90 * DAY_MS;
/** `lastUsedAt` is only rewritten when the stored value is older than this. */
const LAST_USED_RESOLUTION_MS = 60_000;
/** Hard cap of rows handled by one purge (it runs inline on `open`). */
export const PURGE_BATCH_MAX = 100;
const LOG_PREFIX = '[ecommerce:accounts]';

export type RevokeReason =
  | 'LOGOUT'
  | 'REVOKED_BY_CUSTOMER'
  | 'PASSWORD_CHANGED'
  | 'EMAIL_CHANGED'
  | 'BLOCKED'
  | 'ADMIN_PASSWORD'
  | 'PASSWORD_RESET';

export type AccountCustomer = {
  id: number;
  email: string;
  emailNormalized: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  locale: string | null;
  accountType: 'GUEST' | 'REGISTERED';
  emailVerified: boolean;
  blocked: boolean;
  passwordChangedAt: string | null;
  pendingEmail: string | null;
};

export type SessionView = {
  id: number;
  createdAt: string | null;
  lastUsedAt: string | null;
  userAgent: string | null;
  ipPrefix: string | null;
  current: boolean;
};

export const deriveCustomerJwtSecret = (keySource: string): Buffer =>
  Buffer.from(hkdfSync('sha256', keySource, Buffer.alloc(0), HKDF_INFO, 32));

const time = (v: unknown): number =>
  v instanceof Date
    ? v.getTime()
    : typeof v === 'string' || typeof v === 'number'
      ? new Date(v).getTime()
      : NaN;
const iso = (v: unknown): string | null => {
  const t = time(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const changed = (r: unknown): number =>
  isRecord(r) && Number.isInteger(r.count) ? (r.count as number) : 0;

const toAccountCustomer = (c: Record<string, any>): AccountCustomer => ({
  id: c.id,
  email: String(c.email ?? ''),
  emailNormalized: String(c.emailNormalized ?? ''),
  firstName: String(c.firstName ?? ''),
  lastName: String(c.lastName ?? ''),
  phone: str(c.phone),
  locale: str(c.locale),
  accountType: c.accountType === 'REGISTERED' ? 'REGISTERED' : 'GUEST',
  emailVerified: c.emailVerified === true,
  blocked: c.blocked === true,
  passwordChangedAt: iso(c.passwordChangedAt),
  pendingEmail: str(c.pendingEmail),
});

const EcommerceCustomerSessionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const sessionsQuery = () => strapi.db.query(uids().customerSession);

  const secret = (): Buffer => {
    const source = resolveEncryptionKeySource(strapi);
    if (!source) throw new EcommerceAccountsUnavailableError();
    return deriveCustomerJwtSecret(source);
  };

  const purgeExpired = async (limit = PURGE_BATCH_MAX): Promise<number> => {
    const take = Number.isFinite(limit)
      ? Math.max(0, Math.min(PURGE_BATCH_MAX, Math.floor(limit)))
      : 0;
    if (take === 0) return 0;
    const now = Date.now();
    const rows: { id: number }[] = await sessionsQuery().findMany({
      where: {
        $or: [
          { expiresAt: { $lt: new Date(now) } },
          { lastUsedAt: { $lt: new Date(now - SESSION_IDLE_MS) } },
        ],
      },
      select: ['id'],
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      limit: take,
    });
    if (rows.length === 0) return 0;
    return changed(await sessionsQuery().deleteMany({ where: { id: { $in: rows.map((r) => r.id) } } }));
  };

  const open = async (
    customerId: number,
    client: { ip: string | null; userAgent: string | null }
  ): Promise<{ token: string; expiresAt: string; sessionId: number }> => {
    const key = secret();
    try {
      await purgeExpired();
    } catch (e) {
      strapi.log.error(`${LOG_PREFIX} SESSION_PURGE_FAILED`);
    }
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_ABSOLUTE_MS);
    const row = await sessionsQuery().create({
      data: {
        customer: customerId,
        expiresAt,
        lastUsedAt: new Date(now),
        userAgent: truncateUserAgent(client.userAgent),
        ipPrefix: ipPrefix(client.ip),
      },
    });
    const token = await new SignJWT({ sid: String(row.id) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(customerId))
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(expiresAt)
      .sign(key);
    return { token, expiresAt: expiresAt.toISOString(), sessionId: row.id };
  };

  /** Any failure (bad token, row state, customer state) is `null`; only a missing key throws. */
  const resolve = async (
    token: string
  ): Promise<{ sessionId: number; customer: AccountCustomer } | null> => {
    const key = secret();
    if (typeof token !== 'string' || token === '') return null;
    let sub: unknown;
    let sid: unknown;
    let iat: unknown;
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: new Date(Date.now()),
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      });
      ({ sub, sid, iat } = payload as Record<string, unknown>);
    } catch {
      return null;
    }
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof iat !== 'number') return null;
    if (!/^\d+$/.test(sub) || !/^\d+$/.test(sid)) return null;
    const row = await sessionsQuery().findOne({
      where: { id: Number(sid) },
      populate: { customer: true },
    });
    if (!row || row.revokedAt) return null;
    const customer = row.customer;
    if (!customer || String(customer.id) !== sub) return null;
    const now = Date.now();
    if (!(time(row.expiresAt) > now)) return null;
    const lastUsed = time(row.lastUsedAt);
    if (!(now - lastUsed <= SESSION_IDLE_MS)) return null;
    if (customer.blocked === true) return null;
    if (customer.accountType !== 'REGISTERED' || customer.emailVerified !== true) return null;
    if (customer.passwordChangedAt) {
      const changedAt = time(customer.passwordChangedAt);
      // iat has one-second resolution, so compare at that resolution.
      if (!Number.isNaN(changedAt) && iat < Math.floor(changedAt / 1000)) return null;
    }
    if (!(now - lastUsed <= LAST_USED_RESOLUTION_MS)) {
      await sessionsQuery().update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } });
    }
    return { sessionId: row.id, customer: toAccountCustomer(customer) };
  };

  const revoke = async (
    customerId: number,
    sessionId: number,
    reason: RevokeReason
  ): Promise<boolean> => {
    const n = changed(
      await sessionsQuery().updateMany({
        where: { id: sessionId, customer: { id: customerId }, revokedAt: { $null: true } },
        data: { revokedAt: new Date(), revokeReason: reason },
      })
    );
    return n > 0;
  };

  const revokeAll = async (
    customerId: number,
    reason: RevokeReason,
    exceptSessionId?: number
  ): Promise<number> => {
    const where: Record<string, unknown> = {
      customer: { id: customerId },
      revokedAt: { $null: true },
    };
    if (exceptSessionId !== undefined) where.id = { $ne: exceptSessionId };
    return changed(
      await sessionsQuery().updateMany({
        where,
        data: { revokedAt: new Date(), revokeReason: reason },
      })
    );
  };

  const list = async (customerId: number, currentSessionId: number): Promise<SessionView[]> => {
    const now = Date.now();
    const rows: Record<string, any>[] = await sessionsQuery().findMany({
      where: {
        customer: { id: customerId },
        revokedAt: { $null: true },
        expiresAt: { $gt: new Date(now) },
      },
      orderBy: [{ id: 'asc' }],
    });
    return rows
      .filter((r) => now - time(r.lastUsedAt) <= SESSION_IDLE_MS)
      .map((r) => ({
        id: r.id,
        createdAt: iso(r.createdAt),
        lastUsedAt: iso(r.lastUsedAt),
        userAgent: str(r.userAgent),
        ipPrefix: str(r.ipPrefix),
        current: r.id === currentSessionId,
      }));
  };

  return { open, resolve, revoke, revokeAll, list, purgeExpired };
};

export default EcommerceCustomerSessionService;
