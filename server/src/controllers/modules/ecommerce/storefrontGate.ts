import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import {
  CLIENT_IP_HEADER,
  CLIENT_USER_AGENT_HEADER,
  clientIpFrom,
  rateKeys,
  type RateLimiter,
  type RateRuleName,
} from '../../../services/modules/ecommerce/domain/storefront';
import {
  decideAccess,
  type AccessDecision,
  type CustomerAccountsMode,
  type RouteClass,
} from '../../../services/modules/ecommerce/domain/accounts/access';
import type { CheckoutSession } from '../../../services/modules/ecommerce/storefrontSessions';
import type { CartOwner } from '../../../services/modules/ecommerce/storefrontCheckout';
import type { AccountCustomer } from '../../../services/modules/ecommerce/customerSessions';
import {
  LOG_PREFIX,
  handleStorefrontError,
  sendAccessDenied,
  sendTooManyRequests,
  type StorefrontErrorOptions,
} from './storefrontErrors';

export const SESSION_HEADER = 'x-checkout-session';
export const CUSTOMER_TOKEN_HEADER = 'x-customer-token';
export { CLIENT_USER_AGENT_HEADER };

const MODES: readonly CustomerAccountsMode[] = ['GUEST_ONLY', 'REGISTERED_ONLY', 'BOTH'];

export type Result = { status?: number; body: unknown };

export type LoginSession = { sessionId: number; customer: AccountCustomer };

/** What a route runs as, once the access matrix allowed it. */
export type Access = {
  as: 'guest' | 'customer' | 'none';
  guest: CheckoutSession | null;
  login: LoginSession | null;
  /** The cart owner for `as: guest | customer`; null for `none`. */
  owner: CartOwner | null;
};

export type GateOptions = {
  routeClass: RouteClass;
  rule: RateRuleName;
  /** On top of the matrix: `guest` needs a guest session, `session` any session. */
  needs?: 'guest' | 'session';
  /** The body's e-mail, for the rule's e-mail key. */
  email?: unknown;
  /** Count the e-mail key without a session too (account routes); default: only with one. */
  emailWithoutSession?: boolean;
  /** Count the e-mail key only for a guest session (checkout e-mail verification). */
  emailForGuestOnly?: boolean;
  notFound?: StorefrontErrorOptions['notFound'];
};

const isDenied = (d: AccessDecision): d is Extract<AccessDecision, { allow: false }> => d.allow === false;

export const headerOf = (ctx: any, name: string): string => {
  const v = ctx.request?.headers?.[name] ?? ctx.request?.header?.[name];
  if (typeof v === 'string') return v;
  return Array.isArray(v) ? v.join(',') : '';
};

/**
 * Shared front door of the storefront controllers: reads the mode, resolves both session
 * headers, applies the access matrix (domain/accounts/access.ts), rate limits and maps errors.
 * Logs carry codes and rule names only, never a request body, a token or an e-mail.
 */
export const createStorefrontGate = ({ strapi, limiter }: { strapi: Core.Strapi; limiter: RateLimiter }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const warn = (message: string) => strapi.log.warn(`${LOG_PREFIX} ${message}`);
  const ipOf = (ctx: any) => clientIpFrom(headerOf(ctx, CLIENT_IP_HEADER));
  const clientOf = (ctx: any) => ({
    ip: ipOf(ctx),
    userAgent: headerOf(ctx, CLIENT_USER_AGENT_HEADER) || null,
  });

  /** The settings are the source, read once per request; anything unknown is GUEST_ONLY. */
  const modeOf = async (): Promise<CustomerAccountsMode> => {
    const settings = await service('EcommerceSettingsService').getStoreSettings();
    const mode = settings?.customerAccountsMode;
    return MODES.includes(mode) ? mode : 'GUEST_ONLY';
  };

  /** Resolves `X-Customer-Token` when sent: the session, or `invalid`. Throws without a key source. */
  const resolveLogin = async (ctx: any): Promise<LoginSession | 'none' | 'invalid'> => {
    const token = headerOf(ctx, CUSTOMER_TOKEN_HEADER);
    if (!token) return 'none';
    const resolved = await service('EcommerceCustomerSessionService').resolve(token);
    return resolved ?? 'invalid';
  };

  const resolveGuest = async (ctx: any): Promise<CheckoutSession | null> => {
    const token = headerOf(ctx, SESSION_HEADER);
    return token ? service('EcommerceStorefrontSessionService').resolve(token) : null;
  };

  /**
   * True (and a 429 sent) when any key of the rule is over its limit; the keys are counted only
   * when all of them allow the request (check-then-hit).
   */
  const limited = (
    ctx: any,
    rule: RateRuleName,
    dims: { session: { kind: 'guest' | 'customer'; id: number } | null; email?: string | null }
  ): boolean => {
    const r = limiter.hitAll(
      rateKeys(rule, {
        sessionId: dims.session?.id ?? null,
        sessionKind: dims.session?.kind,
        ip: ipOf(ctx),
        email: dims.email ?? null,
      })
    );
    if (r.allowed) return false;
    // The rule name only: keys carry the session id, the IP or the e-mail hash.
    warn(`RATE_LIMITED ${rule}`);
    sendTooManyRequests(ctx, 'RATE_LIMITED', r.retryAfterSec);
    return true;
  };

  const respond = async (
    ctx: any,
    opts: StorefrontErrorOptions,
    fn: () => Promise<Result>
  ): Promise<void> => {
    try {
      const r = await fn();
      ctx.status = r.status ?? 200;
      ctx.body = r.body;
    } catch (err) {
      handleStorefrontError(ctx, err, { ...opts, log: strapi.log });
    }
  };

  const fail = (ctx: any, err: unknown, opts: StorefrontErrorOptions) =>
    handleStorefrontError(ctx, err, { ...opts, log: strapi.log });

  /**
   * Every non-catalog route: decide, limit, then run. In GUEST_ONLY the login token is never
   * resolved (account routes answer 403 first, the others ignore it); otherwise a sent token is
   * always resolved, and an invalid one refuses the request even where a guest could run.
   */
  const run = async (
    ctx: any,
    opts: GateOptions,
    fn: (access: Access, errorOpts: StorefrontErrorOptions) => Promise<Result>
  ): Promise<void> => {
    const errorOpts: StorefrontErrorOptions = { notFound: opts.notFound ?? 'ORDER_NOT_FOUND' };
    let mode: CustomerAccountsMode;
    let guest: CheckoutSession | null = null;
    let login: LoginSession | 'none' | 'invalid' = 'none';
    const accountRoute = opts.routeClass === 'account-public' || opts.routeClass === 'account-private';
    try {
      mode = await modeOf();
      const accountsOn = mode !== 'GUEST_ONLY';
      if (accountsOn) login = await resolveLogin(ctx);
      const wantsGuest = !accountRoute || opts.needs !== undefined;
      if (wantsGuest && (accountsOn || !accountRoute)) guest = await resolveGuest(ctx);
    } catch (err) {
      return fail(ctx, err, errorOpts);
    }

    let decision = decideAccess(mode, opts.routeClass, {
      guest: guest !== null,
      customer: typeof login === 'object' ? 'valid' : login,
    });
    if (decision.allow) {
      if (opts.needs === 'guest' && !guest) decision = { allow: false, status: 401, code: 'SESSION_INVALID' };
      else if (opts.needs === 'session' && decision.as === 'none') {
        decision = { allow: false, status: 401, code: 'SESSION_INVALID' };
      }
    }
    const denied = isDenied(decision) ? decision : null;
    // 403 ACCOUNTS_DISABLED costs nothing (no lookup was made): answered before any counting.
    if (denied?.code === 'ACCOUNTS_DISABLED') return sendAccessDenied(ctx, denied.status, denied.code);

    const loginSession = typeof login === 'object' ? login : null;
    const as = isDenied(decision) ? 'none' : decision.as;
    // A request that needs a guest session runs on it (login), even when a login session is valid.
    const session =
      opts.needs === 'guest' && guest
        ? { kind: 'guest' as const, id: guest.id }
        : as === 'customer' && loginSession
          ? { kind: 'customer' as const, id: loginSession.sessionId }
          : as === 'guest' && guest
            ? { kind: 'guest' as const, id: guest.id }
            : null;
    const emailCounts = opts.emailForGuestOnly ? session?.kind === 'guest' : !!session || !!opts.emailWithoutSession;
    const email = typeof opts.email === 'string' && emailCounts ? opts.email : null;
    if (limited(ctx, opts.rule, { session, email })) return;
    if (denied) {
      warn(denied.code);
      return sendAccessDenied(ctx, denied.status, denied.code);
    }

    const owner: CartOwner | null =
      as === 'customer' && loginSession
        ? { kind: 'customer', customer: loginSession.customer, sessionId: loginSession.sessionId }
        : as === 'guest' && guest
          ? { kind: 'guest', session: guest }
          : null;
    const access: Access = { as, guest, login: loginSession, owner };
    return respond(ctx, errorOpts, () => fn(access, errorOpts));
  };

  return { run, respond, limited, modeOf, resolveLogin, resolveGuest, ipOf, clientOf, warn, fail, limiter };
};

export type StorefrontGate = ReturnType<typeof createStorefrontGate>;
