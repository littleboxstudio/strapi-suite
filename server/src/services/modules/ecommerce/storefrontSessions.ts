import type { Core } from '@strapi/strapi';
import { randomBytes } from 'node:crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { normalizeEmail } from './domain/email';
import { isRecord } from './orderPricingHelpers';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionExpiry,
} from './domain/storefront/session';

/** Server-side cart of an anonymous checkout session (stored as a JSON object). */
export type StoredCart = {
  lines: { variantId: number; quantity: number }[];
  promotionCodes: string[];
  giftChoices: Record<string, number>;
  email: string | null;
  destination: { country: string; postalCode?: string } | null;
  shippingMethod: { providerId: string; serviceId: string } | null;
  locale: string | null;
};

/** Deeply frozen reference value; use `emptyCart()` for a cart to modify or store. */
export const EMPTY_CART: StoredCart = Object.freeze({
  lines: Object.freeze([]) as unknown as StoredCart['lines'],
  promotionCodes: Object.freeze([]) as unknown as string[],
  giftChoices: Object.freeze({}) as Record<string, number>,
  email: null,
  destination: null,
  shippingMethod: null,
  locale: null,
}) as StoredCart;

export type CheckoutSession = {
  id: number;
  expiresAt: string;
  cart: StoredCart;
  verifiedEmail: string | null;
  emailVerification: Record<string, unknown>;
  verificationAttempts: number;
};

export type OpenedSession = { token: string | null; expiresAt: string; reused: boolean };

/** Hard cap of sessions handled by one purge (it runs inline on `open`). */
export const PURGE_BATCH_MAX = 100;
/**
 * The purge only takes sessions expired for longer than this, so a request that resolved its
 * session just before expiry (e.g. an order being created) always finishes first.
 */
export const PURGE_GRACE_MS = 3_600_000;
/** `lastUsedAt` is only rewritten when the stored value is older than this. */
const LAST_USED_RESOLUTION_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const changed = (r: unknown): number =>
  isRecord(r) && Number.isInteger(r.count) ? (r.count as number) : 0;
const LOG_PREFIX = '[ecommerce:storefront]';

export const emptyCart = (): StoredCart => ({
  lines: [],
  promotionCodes: [],
  giftChoices: {},
  email: null,
  destination: null,
  shippingMethod: null,
  locale: null,
});

/** Personal data dropped when a session expires (the row itself may have to stay). */
const scrubbed = () => ({
  cart: emptyCart(),
  emailVerification: {},
  verifiedEmail: null,
  verificationAttempts: 0,
});

/** Missing or mistyped fields fall back to the empty cart's (the column is written only here). */
const toStoredCart = (raw: unknown): StoredCart => {
  const c = isRecord(raw) ? raw : {};
  const base = emptyCart();
  return {
    lines: Array.isArray(c.lines) ? (c.lines as StoredCart['lines']) : base.lines,
    promotionCodes: Array.isArray(c.promotionCodes)
      ? (c.promotionCodes as string[])
      : base.promotionCodes,
    giftChoices: isRecord(c.giftChoices)
      ? (c.giftChoices as Record<string, number>)
      : base.giftChoices,
    email: typeof c.email === 'string' ? c.email : null,
    destination: isRecord(c.destination) ? (c.destination as StoredCart['destination']) : null,
    shippingMethod: isRecord(c.shippingMethod)
      ? (c.shippingMethod as StoredCart['shippingMethod'])
      : null,
    locale: typeof c.locale === 'string' ? c.locale : null,
  };
};

const time = (v: unknown): number =>
  v instanceof Date
    ? v.getTime()
    : typeof v === 'string' || typeof v === 'number'
      ? new Date(v).getTime()
      : NaN;

const EcommerceStorefrontSessionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const sessionsQuery = () => strapi.db.query(uids().checkoutSession);
  const settings = () => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');

  /**
   * Retires expired ACTIVE sessions: those without orders are deleted; those with orders stay
   * (the order keeps its relation) but are marked EXPIRED and scrubbed. Orders are only read
   * through the relation, never changed (requirement 2.13). Writes are conditional on ACTIVE,
   * so a concurrent purge or resolve is harmless. Returns the rows actually changed.
   */
  const retire = async (ids: number[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const orders: { checkoutSession?: { id: number } | null }[] = await strapi.db
      .query(uids().order)
      .findMany({
        where: { checkoutSession: { id: { $in: ids } } },
        select: ['id'],
        populate: { checkoutSession: { select: ['id'] } },
      });
    const withOrders = new Set(
      orders.map((o) => o.checkoutSession?.id).filter((id): id is number => typeof id === 'number')
    );
    const keep = ids.filter((id) => withOrders.has(id));
    const remove = ids.filter((id) => !withOrders.has(id));
    let count = 0;
    if (remove.length > 0) {
      count += changed(
        await sessionsQuery().deleteMany({ where: { id: { $in: remove }, status: 'ACTIVE' } })
      );
    }
    if (keep.length > 0) {
      count += changed(
        await sessionsQuery().updateMany({
          where: { id: { $in: keep }, status: 'ACTIVE' },
          data: { status: 'EXPIRED', ...scrubbed() },
        })
      );
    }
    return count;
  };

  /**
   * Looks the session up by the SHA-256 of the token (never the raw token). Malformed,
   * unknown, non-ACTIVE and expired tokens all give `null`; an expired ACTIVE row is retired
   * on the spot (deleted, or scrubbed and EXPIRED when it has orders).
   */
  const resolve = async (token: unknown): Promise<CheckoutSession | null> => {
    if (!isWellFormedSessionToken(token)) return null;
    const row = await sessionsQuery().findOne({ where: { tokenHash: hashSessionToken(token) } });
    if (!row || row.status !== 'ACTIVE') return null;
    const now = Date.now();
    const expiresAt = time(row.expiresAt);
    if (!(expiresAt > now)) {
      await retire([row.id]);
      return null;
    }
    const lastUsed = time(row.lastUsedAt);
    if (!(now - lastUsed <= LAST_USED_RESOLUTION_MS)) {
      await sessionsQuery().update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } });
    }
    return {
      id: row.id,
      expiresAt: new Date(expiresAt).toISOString(),
      cart: toStoredCart(row.cart),
      verifiedEmail: typeof row.verifiedEmail === 'string' ? row.verifiedEmail : null,
      emailVerification: isRecord(row.emailVerification) ? row.emailVerification : {},
      verificationAttempts: Number.isInteger(row.verificationAttempts)
        ? row.verificationAttempts
        : 0,
    };
  };

  /**
   * Data retention without a cron: retires up to `limit` (≤ 100) ACTIVE sessions expired for
   * more than `PURGE_GRACE_MS`. Returns the rows actually changed.
   */
  const purgeExpired = async (limit = PURGE_BATCH_MAX): Promise<number> => {
    const take = Number.isFinite(limit)
      ? Math.max(0, Math.min(PURGE_BATCH_MAX, Math.floor(limit)))
      : 0;
    if (take === 0) return 0;
    const cutoff = new Date(Date.now() - PURGE_GRACE_MS);
    const expired: { id: number }[] = await sessionsQuery().findMany({
      where: { status: 'ACTIVE', expiresAt: { $lt: cutoff } },
      select: ['id'],
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      limit: take,
    });
    return retire(expired.map((s) => s.id));
  };

  /**
   * Requirement 2.3: a valid current token is reused (the BFF already holds it, the server only
   * knows its hash), otherwise a new session is created and its token returned this once.
   * The TTL runs from creation and is never extended.
   */
  const open = async (currentToken: string | null): Promise<OpenedSession> => {
    const current = await resolve(currentToken);
    if (current) return { token: null, expiresAt: current.expiresAt, reused: true };
    try {
      await purgeExpired();
    } catch (e) {
      strapi.log.error(
        `${LOG_PREFIX} session purge failed: ${(e as Error)?.message ?? 'unknown error'}`
      );
    }
    const { checkoutSessionTtlHours } = await settings().getStoreSettings();
    const token = generateSessionToken(randomBytes);
    const expiresAt = sessionExpiry(new Date(), checkoutSessionTtlHours);
    await sessionsQuery().create({
      data: {
        tokenHash: hashSessionToken(token),
        status: 'ACTIVE',
        expiresAt,
        cart: emptyCart(),
        emailVerification: {},
        verificationAttempts: 0,
      },
    });
    return { token, expiresAt: expiresAt.toISOString(), reused: false };
  };

  const saveCart = async (sessionId: number, cart: StoredCart): Promise<void> => {
    await sessionsQuery().update({
      where: { id: sessionId, status: 'ACTIVE', expiresAt: { $gt: new Date() } },
      data: { cart: toStoredCart(cart) },
    });
  };

  /** After an order: lines, codes, gift choices and shipping method go; e-mail, destination and locale stay. */
  const clearCart = async (sessionId: number): Promise<void> => {
    const row = await sessionsQuery().findOne({ where: { id: sessionId }, select: ['id', 'cart'] });
    if (!row) return;
    const current = toStoredCart(row.cart);
    await saveCart(sessionId, {
      ...emptyCart(),
      email: current.email,
      destination: current.destination,
      locale: current.locale,
    });
  };

  const isEmailVerified = (s: CheckoutSession, email: string): boolean =>
    s.verifiedEmail !== null && s.verifiedEmail === normalizeEmail(email);

  /**
   * Ownership is the order's checkoutSession relation. Another session's order and an unknown
   * publicId are indistinguishable to the caller; the log line carries neither id nor token.
   */
  const findOwnedOrder = async (
    s: CheckoutSession,
    publicId: unknown
  ): Promise<{ id: number; publicId: string } | null> => {
    if (typeof publicId !== 'string' || !UUID.test(publicId)) return null;
    // Stored lower-case (randomUUID); case-sensitive collations (Postgres) must match too.
    const order = await strapi.db.query(uids().order).findOne({
      where: { publicId: publicId.toLowerCase(), checkoutSession: { id: s.id } },
      select: ['id', 'publicId'],
    });
    if (!order) {
      strapi.log.warn(`${LOG_PREFIX} ORDER_ACCESS_DENIED`);
      return null;
    }
    return { id: order.id, publicId: order.publicId };
  };

  return { open, resolve, purgeExpired, saveCart, clearCart, isEmailVerified, findOwnedOrder };
};

export default EcommerceStorefrontSessionService;
