import type { Core } from '@strapi/strapi';
import { randomBytes, randomInt } from 'node:crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isValidEmailFormat, normalizeEmail } from './domain/email';
import { isRecord } from './orderPricingHelpers';
import {
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  deriveVerificationSecret,
  generateSessionToken,
  generateVerificationCode,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionExpiry,
  verificationCodeHash,
  verificationCodeMatches,
} from './domain/storefront/session';
import { EcommerceEmailError, EcommerceValidationError } from './errors';
import { resolveEncryptionKeySource } from './secrets';
import { sendWithResend } from './providers/email/resendSender';

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

/** Pending code stored in `emailVerification` (only the HMAC of the code, never the code). */
type PendingVerification = { emailNormalized: string; codeHash: string; expiresAt: string };

const pendingOf = (raw: unknown): PendingVerification | null =>
  isRecord(raw) &&
  typeof raw.emailNormalized === 'string' &&
  typeof raw.codeHash === 'string' &&
  typeof raw.expiresAt === 'string'
    ? { emailNormalized: raw.emailNormalized, codeHash: raw.codeHash, expiresAt: raw.expiresAt }
    : null;

const VERIFICATION_CODE = /^\d{6}$/;
const MAX_EMAIL_LENGTH = 254;

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

  /** HMAC key for the codes; null when no encryption key is configured. */
  const verificationSecret = (): Buffer | null => {
    const source = resolveEncryptionKeySource(strapi);
    return source ? deriveVerificationSecret(source) : null;
  };

  const codeInvalid = () =>
    new EcommerceValidationError('Invalid verification code', [
      { path: 'code', code: 'VERIFICATION_CODE_INVALID' },
    ]);

  /** The session row is gone or no longer ACTIVE (same answer as a failed `resolve`). */
  const sessionInvalid = () =>
    new EcommerceValidationError('Invalid session', [{ path: 'session', code: 'SESSION_INVALID' }]);

  /** Parallel confirmations kept winning the compare-and-set: transient, retry later. */
  const verificationConflict = () =>
    new EcommerceValidationError('Concurrent verification attempts', [
      { path: 'code', code: 'VERIFICATION_CONFLICT' },
    ]);

  const warnSecretMissing = () =>
    strapi.log.warn(
      `${LOG_PREFIX} e-mail verification secret missing (LTB_ECOMMERCE_ENCRYPTION_KEY)`
    );

  const codeLocked = () => {
    strapi.log.warn(`${LOG_PREFIX} VERIFICATION_LOCKED`);
    return new EcommerceValidationError('Too many verification attempts', [
      { path: 'code', code: 'VERIFICATION_LOCKED' },
    ]);
  };

  /**
   * After a failed send: puts back what was there before (the previous, still valid code when
   * the attempts were kept, so a send failure can never lift a lock; `{}` otherwise), but only
   * while the pending record is still the one this request wrote, so a concurrent request's
   * code is never wiped. The JSON column cannot be compared portably, hence a re-read plus a
   * compare-and-set on the scalar attempts column; the remaining window is tiny.
   */
  const undoPending = async (
    sessionId: number,
    codeHash: string,
    restore: PendingVerification | Record<string, never> | null
  ): Promise<void> => {
    const current = await sessionsQuery().findOne({
      where: { id: sessionId, status: 'ACTIVE' },
      select: ['id', 'emailVerification', 'verificationAttempts'],
    });
    if (!current || pendingOf(current.emailVerification)?.codeHash !== codeHash) return;
    await sessionsQuery().updateMany({
      where: {
        id: sessionId,
        status: 'ACTIVE',
        verificationAttempts: current.verificationAttempts ?? null,
      },
      data: { emailVerification: restore ?? {} },
    });
  };

  /**
   * Sends a 6-digit code to `email` directly through Resend (never through the notification
   * queue, so the code is never stored). Only its HMAC is kept on the session. A new code for
   * the same e-mail while the previous one is still valid keeps `verificationAttempts`, so
   * asking for another code never lifts a lock: while locked, the request is refused (nothing
   * written or sent) and the lock lifts at the pending code's original expiry.
   */
  const requestEmailVerification = async (
    s: CheckoutSession,
    input: { email: unknown; locale: string }
  ): Promise<{ expiresAt: string }> => {
    const email = typeof input?.email === 'string' ? normalizeEmail(input.email) : '';
    if (!isValidEmailFormat(email) || email.length > MAX_EMAIL_LENGTH) {
      throw new EcommerceValidationError('Invalid e-mail', [
        { path: 'email', code: 'invalid_email' },
      ]);
    }
    const rt = await settings().getRuntime('resend');
    const secret = verificationSecret();
    if (!secret) warnSecretMissing();
    if (!rt || !rt.active || !secret) {
      throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not active.');
    }
    const row = await sessionsQuery().findOne({
      where: { id: s.id, status: 'ACTIVE' },
      select: ['id', 'emailVerification', 'verificationAttempts'],
    });
    if (!row) throw sessionInvalid();
    const now = Date.now();
    const previous = pendingOf(row.emailVerification);
    const keepAttempts =
      previous !== null && previous.emailNormalized === email && time(previous.expiresAt) > now;
    const attempts = Number.isInteger(row.verificationAttempts) ? row.verificationAttempts : 0;
    if (keepAttempts && attempts >= VERIFICATION_MAX_ATTEMPTS) throw codeLocked();

    const code = generateVerificationCode(randomInt);
    const codeHash = verificationCodeHash(secret, s.id, email, code);
    const expiresAt = new Date(now + VERIFICATION_CODE_TTL_MS).toISOString();
    const pending: PendingVerification = { emailNormalized: email, codeHash, expiresAt };
    await sessionsQuery().updateMany({
      where: { id: s.id, status: 'ACTIVE' },
      data: { emailVerification: pending, ...(keepAttempts ? {} : { verificationAttempts: 0 }) },
    });

    try {
      const message = await strapi
        .plugin(PLUGIN_ID)
        .service('EcommerceEmailTemplateService')
        .render('EMAIL_VERIFICATION', input.locale, {
          customer: { email },
          verification: { code, validMinutes: String(VERIFICATION_CODE_TTL_MS / 60_000) },
        });
      await sendWithResend(rt, {
        to: email,
        subject: message.subject,
        html: message.html,
        idempotencyKey: `verify:${s.id}:${codeHash}`,
      });
    } catch (err) {
      await undoPending(s.id, codeHash, keepAttempts ? previous : {});
      throw err;
    }
    return { expiresAt };
  };

  /**
   * Checks a code. The attempt is counted first, with a conditional update on the scalar
   * column (portable compare-and-set), and only then compared in constant time; parallel
   * confirmations can never compare more than `VERIFICATION_MAX_ATTEMPTS` codes.
   */
  const confirmEmailVerification = async (
    s: CheckoutSession,
    input: { email: unknown; code: unknown }
  ): Promise<{ verified: true }> => {
    const email = typeof input?.email === 'string' ? normalizeEmail(input.email) : '';
    const code = typeof input?.code === 'string' ? input.code.trim() : '';
    // Attempts only grow, so this bounds the compare-and-set retries.
    for (let round = 0; round <= VERIFICATION_MAX_ATTEMPTS; round++) {
      const row = await sessionsQuery().findOne({
        where: { id: s.id, status: 'ACTIVE' },
        select: ['id', 'emailVerification', 'verificationAttempts'],
      });
      if (!row) throw sessionInvalid();
      const pending = pendingOf(row.emailVerification);
      if (
        !pending ||
        pending.emailNormalized !== email ||
        !(time(pending.expiresAt) > Date.now())
      ) {
        throw codeInvalid();
      }
      const attempts = Number.isInteger(row.verificationAttempts) ? row.verificationAttempts : 0;
      if (attempts >= VERIFICATION_MAX_ATTEMPTS) throw codeLocked();
      const counted = changed(
        await sessionsQuery().updateMany({
          where: {
            id: s.id,
            status: 'ACTIVE',
            verificationAttempts: row.verificationAttempts ?? null,
          },
          data: { verificationAttempts: attempts + 1 },
        })
      );
      if (counted === 0) continue; // a parallel confirmation counted first: read again

      const secret = verificationSecret();
      if (!secret) warnSecretMissing();
      if (!VERIFICATION_CODE.test(code) || !secret) throw codeInvalid();
      if (
        !verificationCodeMatches(pending.codeHash, verificationCodeHash(secret, s.id, email, code))
      ) {
        throw codeInvalid();
      }
      // Conditional on the attempt just counted: a request for another e-mail or after expiry
      // (both reset the counter) in between makes this write miss.
      const verified = changed(
        await sessionsQuery().updateMany({
          where: { id: s.id, status: 'ACTIVE', verificationAttempts: attempts + 1 },
          data: { verifiedEmail: email, emailVerification: {}, verificationAttempts: 0 },
        })
      );
      if (verified === 0) throw codeInvalid();
      return { verified: true };
    }
    throw verificationConflict();
  };

  return {
    open,
    resolve,
    purgeExpired,
    saveCart,
    clearCart,
    isEmailVerified,
    findOwnedOrder,
    requestEmailVerification,
    confirmEmailVerification,
  };
};

export default EcommerceStorefrontSessionService;
