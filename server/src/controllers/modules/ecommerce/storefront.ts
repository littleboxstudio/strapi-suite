import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import {
  createRateLimiter,
  type RateRuleName,
} from '../../../services/modules/ecommerce/domain/storefront';
import type { RouteClass } from '../../../services/modules/ecommerce/domain/accounts/access';
import {
  MAX_CART_LINES,
  MAX_EMAIL_LENGTH,
  MAX_LINE_QUANTITY,
  MAX_PICKUP_POINT_ID_LENGTH,
  MAX_POSTAL_CODE_LENGTH,
  MAX_SHIPPING_ID_LENGTH,
  MAX_STORE_CREDIT_CODE_LENGTH,
  MAX_PROMOTION_CODE_LENGTH,
} from '../../../services/modules/ecommerce/domain/storefront/limits';
import { VERIFICATION_CODE_TTL_MS } from '../../../services/modules/ecommerce/domain/storefront/session';
import type { CheckoutSession } from '../../../services/modules/ecommerce/storefrontSessions';
import type { CartOwner } from '../../../services/modules/ecommerce/storefrontCheckout';
import { sendAccessDenied, type StorefrontErrorOptions } from './storefrontErrors';
import { MAX_SHORT, asObject, fail, optionalString, promotionFields } from './validation';
import { SESSION_HEADER, createStorefrontGate, headerOf, type Access, type Result } from './storefrontGate';

const INVALID = 'Invalid request';
const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Client part of the order key (the service caps the stored key; this is stricter). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:-]{8,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const MAX_NOTES = 1000;
const ADDRESS_FIELDS = ['firstName', 'lastName', 'company', 'nif', 'line1', 'line2', 'city', 'phone'];

type Lines = { variantId: number; quantity: number }[];

const isId = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max;

/** `min`–100 lines of integer `variantId` and `quantity` in [1, 1000]; nothing else is kept. */
const linesOf = (raw: unknown, min: 0 | 1): Lines => {
  if (!Array.isArray(raw)) return fail(INVALID, 'lines', 'required');
  if (raw.length < min) return fail(INVALID, 'lines', 'required');
  if (raw.length > MAX_CART_LINES) return fail(INVALID, 'lines', 'too_many');
  return raw.map((l, i) => {
    const line = asObject(l);
    if (!isId(line.variantId)) return fail(INVALID, `lines.${i}.variantId`, 'invalid');
    if (!isId(line.quantity, MAX_LINE_QUANTITY)) return fail(INVALID, `lines.${i}.quantity`, 'invalid');
    return { variantId: line.variantId, quantity: line.quantity };
  });
};

const emailOf = (path: string, v: unknown): string | undefined =>
  optionalString(INVALID, path, v, MAX_EMAIL_LENGTH);

const countryOf = (path: string, v: unknown): string => {
  if (typeof v !== 'string' || !COUNTRY.test(v)) return fail(INVALID, path, 'invalid_country');
  return v;
};

const shippingMethodOf = (v: unknown, required: boolean) => {
  if (v === undefined || v === null) {
    return required ? fail(INVALID, 'shippingMethod', 'required') : null;
  }
  const m = asObject(v);
  const providerId = optionalString(INVALID, 'shippingMethod.providerId', m.providerId, MAX_SHIPPING_ID_LENGTH);
  const serviceId = optionalString(INVALID, 'shippingMethod.serviceId', m.serviceId, MAX_SHIPPING_ID_LENGTH);
  if (!providerId || !serviceId) return fail(INVALID, 'shippingMethod', 'invalid');
  return { providerId, serviceId };
};

const destinationOf = (v: unknown) => {
  if (v === undefined || v === null) return null;
  const d = asObject(v);
  const postalCode = optionalString(INVALID, 'destination.postalCode', d.postalCode, MAX_POSTAL_CODE_LENGTH);
  return { country: countryOf('destination.country', d.country), ...(postalCode ? { postalCode } : {}) };
};

/** Only the known address fields, as strings; the order service checks the required ones. */
const addressOf = (path: string, v: unknown) => {
  const a = asObject(v);
  const out: Record<string, string> = {};
  for (const f of ADDRESS_FIELDS) {
    const s = optionalString(INVALID, `${path}.${f}`, a[f], MAX_SHORT);
    if (s !== undefined) out[f] = s;
  }
  const postalCode = optionalString(INVALID, `${path}.postalCode`, a.postalCode, MAX_POSTAL_CODE_LENGTH);
  if (postalCode !== undefined) out.postalCode = postalCode;
  out.country = countryOf(`${path}.country`, a.country);
  return out;
};

/**
 * Storefront API for the BFF (plan 7, Task 10). Every request is rate limited in memory (one
 * limiter per process: valid with a single Strapi instance) by session, client IP (only from
 * `X-Storefront-Client-IP`; `X-Forwarded-For` is never read) and, for the e-mail verification
 * routes, e-mail. Who may call a route is decided per customer-accounts mode by the access
 * matrix (domain/accounts/access.ts, through storefrontGate.ts): the guest session travels in
 * `X-Checkout-Session`, the login session in `X-Customer-Token`; catalog routes read neither.
 * Input is validated and rebuilt from known fields only: prices, discounts,
 * statuses, stock or `emailVerified` sent by the client never reach the services.
 */
const EcommerceStorefrontController = ({ strapi }: { strapi: Core.Strapi }) => {
  const limiter = createRateLimiter();
  const gate = createStorefrontGate({ strapi, limiter });
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const catalog = () => service('EcommerceStorefrontCatalogService');
  const sessions = () => service('EcommerceStorefrontSessionService');
  const checkout = () => service('EcommerceStorefrontCheckoutService');
  const pickup = () => service('EcommercePickupPointService');

  const body = (ctx: any) => asObject(ctx.request?.body);

  /** Catalog only: by client IP, no session (the session headers are never read there). */
  const limited = (ctx: any, rule: RateRuleName): boolean => gate.limited(ctx, rule, { session: null });
  const respond = gate.respond;

  /** Seconds until the session's pending verification code expires (its lock lifts then). */
  const lockSeconds = (s: CheckoutSession): number => {
    const exp = new Date(String(s.emailVerification?.expiresAt ?? '')).getTime();
    const left = Number.isFinite(exp) ? (exp - Date.now()) / 1000 : NaN;
    return left > 0 ? left : VERIFICATION_CODE_TTL_MS / 1000;
  };

  /**
   * Non-catalog routes: both session headers resolved, the access matrix applied for the route
   * class, then limited, then run with the `CartOwner` (guest session or login session). The
   * per-e-mail key counts only with a valid session, so a caller without one cannot spend a
   * customer's e-mail budget.
   */
  const withOwner = (
    ctx: any,
    routeClass: RouteClass,
    rule: RateRuleName,
    opts: { notFound?: StorefrontErrorOptions['notFound']; email?: unknown },
    fn: (owner: CartOwner, errorOpts: StorefrontErrorOptions, access: Access) => Promise<Result>
  ): Promise<void> =>
    gate.run(ctx, { routeClass, rule, notFound: opts.notFound, email: opts.email }, (access, errorOpts) => {
      if (access.owner?.kind === 'guest') errorOpts.lockedRetryAfterSec = lockSeconds(access.owner.session);
      return fn(access.owner as CartOwner, errorOpts, access);
    });

  /** The guest session of a checkout e-mail verification; with a login session it does not apply. */
  const guestSessionOf = (owner: CartOwner): CheckoutSession =>
    owner.kind === 'guest' ? owner.session : fail(INVALID, 'email', 'ACTION_NOT_AVAILABLE');

  const resolveLocale = (raw: unknown): Promise<string> => catalog().resolveLocale(raw);

  /** The cart fields of `/cart/quote` and `/discounts/apply` (0–100 lines). */
  const cartInput = async (b: Record<string, unknown>) => {
    const lines = linesOf(b.lines, 0);
    const { promotionCodes, giftChoices } = promotionFields(INVALID, b);
    return {
      lines,
      locale: await resolveLocale(b.locale),
      email: b.email === null ? null : emailOf('email', b.email) ?? null,
      ...(promotionCodes ? { promotionCodes } : {}),
      ...(giftChoices ? { giftChoices } : {}),
      destination: destinationOf(b.destination),
      shippingMethod: shippingMethodOf(b.shippingMethod, false),
    };
  };

  const orderInput = async (b: Record<string, unknown>) => {
    const lines = linesOf(b.lines, 1);
    if (b.expectedTotal === undefined || b.expectedTotal === null) {
      return fail(INVALID, 'expectedTotal', 'required');
    }
    const { promotionCodes, giftChoices, expectedTotal } = promotionFields(INVALID, b);
    const c = asObject(b.customer);
    const phone = optionalString(INVALID, 'customer.phone', c.phone);
    const storeCreditCode = optionalString(
      INVALID,
      'storeCreditCode',
      b.storeCreditCode,
      MAX_STORE_CREDIT_CODE_LENGTH
    );
    const notes = optionalString(INVALID, 'notes', b.notes, MAX_NOTES);
    const pickupPointId = optionalString(INVALID, 'pickupPointId', b.pickupPointId, MAX_PICKUP_POINT_ID_LENGTH);
    const pickupPostalCode = optionalString(INVALID, 'pickupPostalCode', b.pickupPostalCode, MAX_POSTAL_CODE_LENGTH);
    return {
      customer: {
        firstName: optionalString(INVALID, 'customer.firstName', c.firstName) ?? '',
        lastName: optionalString(INVALID, 'customer.lastName', c.lastName) ?? '',
        email: emailOf('customer.email', c.email) ?? '',
        ...(phone ? { phone } : {}),
      },
      shippingAddress: addressOf('shippingAddress', b.shippingAddress),
      billingAddress:
        b.billingAddress === undefined || b.billingAddress === null
          ? null
          : addressOf('billingAddress', b.billingAddress),
      locale: await resolveLocale(b.locale),
      lines,
      shippingMethod: shippingMethodOf(b.shippingMethod, true),
      ...(promotionCodes ? { promotionCodes } : {}),
      ...(giftChoices ? { giftChoices } : {}),
      expectedTotal: expectedTotal as number,
      ...(storeCreditCode ? { storeCreditCode } : {}),
      ...(notes ? { notes } : {}),
      ...(pickupPointId ? { pickupPointId } : {}),
      ...(pickupPostalCode ? { pickupPostalCode } : {}),
    };
  };

  const publicIdOf = (ctx: any): string => {
    const id = ctx.params?.publicId;
    return typeof id === 'string' && UUID.test(id) ? id : fail(INVALID, 'publicId', 'invalid');
  };

  return {
    /** GET /products?page=&pageSize=&search=&sort=&category=&collection=&tag=&locale= */
    async listProducts(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      const q = ctx.query ?? {};
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().listProducts({
          page: q.page,
          pageSize: q.pageSize,
          search: q.search,
          sort: q.sort,
          category: q.category,
          collection: q.collection,
          tag: q.tag,
          locale: await resolveLocale(q.locale),
        }),
      }));
    },

    /** GET /categories?locale= */
    async listCategories(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().listCategories(await resolveLocale(ctx.query?.locale)),
      }));
    },

    /** GET /categories/:slug?locale= */
    async getCategory(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      const slug = ctx.params?.slug;
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().getCategory(
          typeof slug === 'string' ? slug : '',
          await resolveLocale(ctx.query?.locale)
        ),
      }));
    },

    /** GET /collections?locale=&page=&pageSize= */
    async listCollections(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      const q = ctx.query ?? {};
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().listCollections({
          page: q.page,
          pageSize: q.pageSize,
          locale: await resolveLocale(q.locale),
        }),
      }));
    },

    /** GET /collections/:slug?locale= */
    async getCollection(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      const slug = ctx.params?.slug;
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().getCollection(
          typeof slug === 'string' ? slug : '',
          await resolveLocale(ctx.query?.locale)
        ),
      }));
    },

    /** GET /products/:slug?locale= */
    async getProduct(ctx: any) {
      if (limited(ctx, 'catalog')) return;
      const slug = ctx.params?.slug;
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => ({
        body: await catalog().getProduct(
          typeof slug === 'string' ? slug : '',
          await resolveLocale(ctx.query?.locale)
        ),
      }));
    },

    /**
     * POST /checkout/session: a valid current session (optional header) is reused without
     * counting against `session.create`; only a new session counts.
     */
    async openSession(ctx: any) {
      // A guest session opens in every mode; a sent login token must still be valid.
      try {
        if ((await gate.modeOf()) !== 'GUEST_ONLY' && (await gate.resolveLogin(ctx)) === 'invalid') {
          gate.warn('CUSTOMER_SESSION_INVALID');
          return sendAccessDenied(ctx, 401, 'CUSTOMER_SESSION_INVALID');
        }
      } catch (err) {
        return gate.fail(ctx, err, { notFound: 'NOT_FOUND' });
      }
      const token = headerOf(ctx, SESSION_HEADER);
      const current: CheckoutSession | null = token ? await sessions().resolve(token) : null;
      if (current) {
        ctx.status = 200;
        ctx.body = { token: null, expiresAt: current.expiresAt, reused: true };
        return;
      }
      if (limited(ctx, 'session.create')) return;
      return respond(ctx, { notFound: 'NOT_FOUND' }, async () => {
        const opened = await sessions().open(null);
        return opened.reused
          ? { body: { token: null, expiresAt: opened.expiresAt, reused: true } }
          : { status: 201, body: { token: opened.token, expiresAt: opened.expiresAt } };
      });
    },

    /** GET /cart */
    getCart: (ctx: any) =>
      withOwner(ctx, 'checkout', 'cart.quote', {}, async (owner) => ({ body: await checkout().getCart(owner) })),

    /** POST /cart/quote */
    quoteCart: (ctx: any) =>
      withOwner(ctx, 'checkout', 'cart.quote', {}, async (owner) => ({
        body: await checkout().quote(owner, await cartInput(body(ctx))),
      })),

    /** GET /shipping/pickup-points?postalCode=&country= → `{ points }` (spec 5.1). */
    pickupPoints: (ctx: any) =>
      withOwner(ctx, 'public-session', 'cart.quote', {}, async () => {
        const q = ctx.query ?? {};
        const postalCode = optionalString(INVALID, 'postalCode', q.postalCode, MAX_POSTAL_CODE_LENGTH);
        const country = optionalString(INVALID, 'country', q.country, 2);
        return {
          body: { points: await pickup().search({ postalCode: postalCode ?? '', ...(country ? { country } : {}) }) },
        };
      }),

    /** POST /discounts/apply */
    applyDiscount: (ctx: any) =>
      withOwner(ctx, 'checkout', 'discount.apply', {}, async (owner) => {
        const b = body(ctx);
        const code = optionalString(INVALID, 'code', b.code, MAX_PROMOTION_CODE_LENGTH);
        if (!code) return fail(INVALID, 'code', 'required');
        return { body: await checkout().applyDiscount(owner, { ...(await cartInput(b)), code }) };
      }),

    /** POST /store-credit/check */
    checkStoreCredit: (ctx: any) =>
      withOwner(ctx, 'checkout', 'storeCredit.check', {}, async (owner) => {
        const b = body(ctx);
        const code = optionalString(INVALID, 'code', b.code, MAX_STORE_CREDIT_CODE_LENGTH);
        // A logged-in customer checks against the account e-mail, never the request's.
        const email = owner.kind === 'customer' ? owner.customer.email : emailOf('email', b.email);
        return { body: await checkout().checkStoreCredit({ code, email }) };
      }),

    /** POST /checkout/email-verification → 202 */
    requestEmailVerification: (ctx: any) =>
      withOwner(ctx, 'checkout', 'email.send', { email: body(ctx).email }, async (owner) => {
        const s = guestSessionOf(owner);
        const b = body(ctx);
        const email = emailOf('email', b.email);
        const locale = await resolveLocale(b.locale);
        return {
          status: 202,
          body: await sessions().requestEmailVerification(s, { email, locale }),
        };
      }),

    /** POST /checkout/email-verification/confirm */
    confirmEmailVerification: (ctx: any) =>
      withOwner(ctx, 'checkout', 'email.confirm', { email: body(ctx).email }, async (owner) => {
        const s = guestSessionOf(owner);
        const b = body(ctx);
        const email = emailOf('email', b.email);
        const code = optionalString(INVALID, 'code', b.code, 6);
        return { body: await sessions().confirmEmailVerification(s, { email, code }) };
      }),

    /** POST /orders (Idempotency-Key) → 201 */
    createOrder: (ctx: any) =>
      withOwner(ctx, 'checkout', 'order.create', {}, async (owner, errorOpts) => {
        const key = headerOf(ctx, IDEMPOTENCY_HEADER);
        if (!IDEMPOTENCY_KEY.test(key)) {
          return fail(INVALID, 'idempotencyKey', 'invalid_idempotency_key');
        }
        const input = await orderInput(body(ctx));
        errorOpts.promotionCodes = input.promotionCodes ?? [];
        return { status: 201, body: await checkout().placeOrder(owner, input, key) };
      }),

    /** POST /orders/:publicId/payment */
    paymentLink: (ctx: any) =>
      withOwner(ctx, 'order-existing', 'order.read', {}, async (owner) => ({
        body: await checkout().paymentLink(owner, publicIdOf(ctx)),
      })),

    /** GET /orders/:publicId/status */
    orderStatus: (ctx: any) =>
      withOwner(ctx, 'order-existing', 'order.read', {}, async (owner) => ({
        body: await checkout().orderStatus(owner, publicIdOf(ctx)),
      })),
  };
};

export default EcommerceStorefrontController;
