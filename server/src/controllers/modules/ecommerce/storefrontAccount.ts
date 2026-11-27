import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import {
  STOREFRONT_RATE_RULES,
  createRateLimiter,
  rateKeys,
  type RateRuleName,
} from '../../../services/modules/ecommerce/domain/storefront';
import { MAX_EMAIL_LENGTH } from '../../../services/modules/ecommerce/domain/storefront/limits';
import {
  EcommerceAccountError,
  EcommerceNotFoundError,
  EcommerceRateLimitError,
} from '../../../services/modules/ecommerce/errors';
import type { RouteClass } from '../../../services/modules/ecommerce/domain/accounts/access';
import { MAX_SHORT, asObject, fail, optionalString } from './validation';
import { createStorefrontGate, type Access, type LoginSession, type Result } from './storefrontGate';
import type { StorefrontErrorOptions } from './storefrontErrors';

const INVALID = 'Invalid request';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9]\d{0,15}$/;
/** Link tokens are 32 bytes in base64url (43 characters); anything far longer is not one. */
const MAX_TOKEN = 512;
const MAX_LOCALE = 20;
const MAX_PAGE_PARAM = 10;
/** 202 bodies are never null (Koa would answer 204). */
const VERIFICATION_SENT = { status: 202, body: { status: 'VERIFICATION_SENT' } };
const ACCEPTED = { status: 202, body: { status: 'ACCEPTED' } };
const NO_CONTENT = { status: 204, body: null };

/** A string (any length: the services cap passwords) or absent; any other type is a 400. */
const passwordOf = (path: string, v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : fail(INVALID, path, 'invalid');
};

const text = (path: string, v: unknown, max = MAX_SHORT) => optionalString(INVALID, path, v, max);
const emailOf = (path: string, v: unknown) => text(path, v, MAX_EMAIL_LENGTH);
const tokenOf = (v: unknown) => text('token', v, MAX_TOKEN);

/** Only the fields present are passed on; unknown fields never reach the service. */
const pick = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

/**
 * Customer-account routes of the storefront API (spec "Modes and endpoint access"). Every route
 * goes through the gate: mode, both session headers, the access matrix, then rate limits.
 * Bodies are validated for type only and rebuilt from known fields; the services own the rules
 * (password policy and length, e-mail format). Request bodies are never logged.
 */
const EcommerceStorefrontAccountController = ({ strapi }: { strapi: Core.Strapi }) => {
  const limiter = createRateLimiter();
  const gate = createStorefrontGate({ strapi, limiter });
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const accounts = () => service('EcommerceAccountService');
  const sessions = () => service('EcommerceCustomerSessionService');
  /** Customer event log; never breaks the answer. */
  const sessionEvent = (customerId: number, scope: 'ONE' | 'OTHERS') => {
    try {
      service('EcommerceCustomerEventService').record(customerId, 'SESSION_REVOKED', {
        actor: { type: 'CUSTOMER' },
        details: { scope },
      });
    } catch (err) {
      strapi.log?.error?.(`[ecommerce:storefront] EVENT_FAILED ${err instanceof Error ? err.name : typeof err}`);
    }
  };
  const body = (ctx: any) => {
    const raw = ctx.request?.body;
    if (raw !== undefined && raw !== null && asObject(raw) !== raw) return fail(INVALID, 'body', 'invalid');
    return asObject(raw);
  };

  const publicRoute = (
    ctx: any,
    rule: RateRuleName,
    opts: { needs?: 'guest' | 'session'; email?: unknown },
    fn: (access: Access) => Promise<Result>
  ) =>
    gate.run(
      ctx,
      { routeClass: 'account-public' as RouteClass, rule, ...opts, emailWithoutSession: true, notFound: 'NOT_FOUND' },
      (access) => fn(access)
    );

  const privateRoute = (
    ctx: any,
    fn: (login: LoginSession) => Promise<Result>,
    opts: { rule?: RateRuleName; notFound?: StorefrontErrorOptions['notFound'] } = {}
  ) =>
    gate.run(
      ctx,
      { routeClass: 'account-private', rule: opts.rule ?? 'account.private', notFound: opts.notFound ?? 'NOT_FOUND' },
      // The matrix allows a private route only with a valid login session.
      async (access) => fn(access.login as LoginSession)
    );

  const emailFromBody = (ctx: any): unknown => asObject(ctx.request?.body).email;

  return {
    /** POST /account/register (guest session) → 202 whatever the e-mail's state. */
    register: (ctx: any) =>
      publicRoute(ctx, 'account.register', { needs: 'guest', email: emailFromBody(ctx) }, async () => {
        const b = body(ctx);
        await accounts().register(
          pick({
            email: emailOf('email', b.email),
            password: passwordOf('password', b.password),
            firstName: text('firstName', b.firstName),
            lastName: text('lastName', b.lastName),
            phone: text('phone', b.phone),
            locale: text('locale', b.locale, MAX_LOCALE),
          })
        );
        return VERIFICATION_SENT;
      }),

    /** POST /account/verify-email (guest session) → 200 { token, expiresAt, customer }. */
    verifyEmail: (ctx: any) =>
      publicRoute(ctx, 'account.token', { needs: 'guest' }, async (access) => ({
        body: await accounts().verifyEmail(tokenOf(body(ctx).token), access.guest, gate.clientOf(ctx)),
      })),

    /** POST /account/verify-email/resend → 202. */
    resendVerification: (ctx: any) =>
      publicRoute(ctx, 'account.email', { email: emailFromBody(ctx) }, async () => {
        await accounts().resendVerification(emailOf('email', body(ctx).email));
        return ACCEPTED;
      }),

    /**
     * POST /account/login (guest session) → 200 { token, expiresAt, customer }. The IP key counts
     * every attempt; the e-mail key is checked first and counted only after a failed one.
     */
    login: (ctx: any) =>
      publicRoute(ctx, 'account.login', { needs: 'guest' }, async (access) => {
        const b = body(ctx);
        const input = { email: emailOf('email', b.email), password: passwordOf('password', b.password) };
        // Only the e-mail key (without an IP, the rule would add its shared unknown-IP key).
        const emailRule = STOREFRONT_RATE_RULES['account.login'].email;
        const emailKeys =
          typeof input.email === 'string'
            ? rateKeys('account.login', { sessionId: null, ip: null, email: input.email }).filter(
                (k) => k.rule === emailRule
              )
            : [];
        const allowed = limiter.check(emailKeys);
        if (!allowed.allowed) {
          gate.warn('RATE_LIMITED account.login');
          throw new EcommerceRateLimitError(allowed.retryAfterSec);
        }
        try {
          return { body: await accounts().login(input, access.guest, gate.clientOf(ctx)) };
        } catch (err) {
          if (err instanceof EcommerceAccountError && err.code === 'INVALID_CREDENTIALS') {
            for (const k of emailKeys) limiter.hit(k.key, k.rule);
          }
          throw err;
        }
      }),

    /** POST /account/password/forgot → 202. */
    forgotPassword: (ctx: any) =>
      publicRoute(ctx, 'account.email', { email: emailFromBody(ctx) }, async () => {
        await accounts().forgotPassword(emailOf('email', body(ctx).email));
        return ACCEPTED;
      }),

    /** POST /account/password/reset (guest session) → 204. */
    resetPassword: (ctx: any) =>
      publicRoute(ctx, 'account.token', { needs: 'guest' }, async () => {
        const b = body(ctx);
        await accounts().resetPassword({ token: tokenOf(b.token), password: passwordOf('password', b.password) });
        return NO_CONTENT;
      }),

    /**
     * POST /account/email/confirm (guest or login session) → 204. A login session is offered to
     * be kept; the service keeps it only when it is the token's customer's.
     */
    confirmEmailChange: (ctx: any) =>
      publicRoute(ctx, 'account.token', { needs: 'session' }, async (access) => {
        const token = tokenOf(body(ctx).token);
        if (access.login) await accounts().confirmEmailChange(token, access.login.sessionId);
        else await accounts().confirmEmailChange(token);
        return NO_CONTENT;
      }),

    /** POST /account/logout → 204. */
    logout: (ctx: any) =>
      privateRoute(ctx, async ({ customer, sessionId }) => {
        await accounts().logout(customer.id, sessionId);
        return NO_CONTENT;
      }),

    /** GET /account/me */
    me: (ctx: any) => privateRoute(ctx, async ({ customer }) => ({ body: await accounts().getProfile(customer) })),

    /** PUT /account/me: first name, last name, phone (null clears) and locale only. */
    updateMe: (ctx: any) =>
      privateRoute(ctx, async ({ customer }) => {
        const b = body(ctx);
        const input = pick({
          firstName: text('firstName', b.firstName),
          lastName: text('lastName', b.lastName),
          phone: b.phone === null ? null : text('phone', b.phone),
          locale: text('locale', b.locale, MAX_LOCALE),
        });
        return { body: await accounts().updateProfile(customer, input) };
      }),

    /** POST /account/password → 200 { token, expiresAt }: the current session's new token. */
    changePassword: (ctx: any) =>
      privateRoute(
        ctx,
        async ({ customer, sessionId }) => {
          const b = body(ctx);
          return {
            body: await accounts().changePassword(customer, sessionId, {
              currentPassword: passwordOf('currentPassword', b.currentPassword),
              newPassword: passwordOf('newPassword', b.newPassword),
            }),
          };
        },
        { rule: 'account.password' }
      ),

    /** POST /account/email → 204; the link goes to the new address. */
    requestEmailChange: (ctx: any) =>
      privateRoute(
        ctx,
        async ({ customer }) => {
          const b = body(ctx);
          await accounts().requestEmailChange(customer, {
            currentPassword: passwordOf('currentPassword', b.currentPassword),
            newEmail: emailOf('newEmail', b.newEmail),
          });
          return NO_CONTENT;
        },
        { rule: 'account.password' }
      ),

    /** GET /account/orders?page=&pageSize= */
    orders: (ctx: any) =>
      privateRoute(ctx, async ({ customer }) => {
        const q = ctx.query ?? {};
        return {
          body: await accounts().listOrders(
            customer,
            pick({ page: text('page', q.page, MAX_PAGE_PARAM), pageSize: text('pageSize', q.pageSize, MAX_PAGE_PARAM) })
          ),
        };
      }),

    /** GET /account/orders/:publicId (another customer's → 404) */
    order: (ctx: any) =>
      privateRoute(
        ctx,
        async ({ customer }) => {
          const id = ctx.params?.publicId;
          const publicId = typeof id === 'string' && UUID.test(id) ? id : fail(INVALID, 'publicId', 'invalid');
          return { body: await accounts().getOrder(customer, publicId) };
        },
        { notFound: 'ORDER_NOT_FOUND' }
      ),

    /** GET /account/sessions → { sessions } */
    sessions: (ctx: any) =>
      privateRoute(ctx, async ({ customer, sessionId }) => ({
        body: { sessions: await sessions().list(customer.id, sessionId) },
      })),

    /** DELETE /account/sessions/:id → 204; another customer's (or an unknown one) → 404. */
    revokeSession: (ctx: any) =>
      privateRoute(ctx, async ({ customer }) => {
        const raw = ctx.params?.id;
        const id = typeof raw === 'string' && ID.test(raw) ? Number(raw) : fail(INVALID, 'id', 'invalid');
        if (!Number.isSafeInteger(id)) return fail(INVALID, 'id', 'invalid');
        const revoked = await sessions().revoke(customer.id, id, 'REVOKED_BY_CUSTOMER');
        if (!revoked) throw new EcommerceNotFoundError('Session not found');
        sessionEvent(customer.id, 'ONE');
        return NO_CONTENT;
      }),

    /** POST /account/sessions/revoke-others → 204; the current session stays. */
    revokeOtherSessions: (ctx: any) =>
      privateRoute(ctx, async ({ customer, sessionId }) => {
        const n = await sessions().revokeAll(customer.id, 'REVOKED_BY_CUSTOMER', sessionId);
        if (n > 0) sessionEvent(customer.id, 'OTHERS');
        return NO_CONTENT;
      }),
  };
};

export default EcommerceStorefrontAccountController;
