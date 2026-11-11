import {
  EcommerceCarrierError,
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../services/modules/ecommerce/errors';
import { normalizePromotionCode, type CodeStatus } from '../../../services/modules/ecommerce/domain/promotions';
import {
  PUBLIC_CODE_STATUSES,
  toPublicCodeStatus,
  type PublicCodeStatus,
} from '../../../services/modules/ecommerce/domain/storefront/publicViews';
import { toPublicStoreCreditError } from '../../../services/modules/ecommerce/domain/storeCredit';
import { CONFLICT_CODES } from './errors';

/**
 * Error responses of the storefront API, in Strapi's error format
 * (`{ data: null, error: { status, name, message, details: { code, errors? } } }`).
 * Public responses never carry promotion ids, raw promotion statuses, provider messages,
 * tokens or personal data.
 */

export const LOG_PREFIX = '[ecommerce:storefront]';

const NAMES: Record<number, string> = {
  400: 'BadRequestError',
  401: 'UnauthorizedError',
  404: 'NotFoundError',
  409: 'ConflictError',
  429: 'TooManyRequestsError',
  502: 'BadGatewayError',
  503: 'ServiceUnavailableError',
};

export const sendError = (
  ctx: any,
  status: number,
  message: string,
  details: Record<string, unknown>
): void => {
  ctx.status = status;
  ctx.body = { data: null, error: { status, name: NAMES[status] ?? 'Error', message, details } };
};

export const sendTooManyRequests = (
  ctx: any,
  code: 'RATE_LIMITED' | 'VERIFICATION_LOCKED',
  retryAfterSec: number
): void => {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSec));
  ctx.set('Retry-After', String(retryAfter));
  sendError(ctx, 429, 'Too many requests', { code, retryAfter });
};

export const sendSessionInvalid = (ctx: any): void =>
  sendError(ctx, 401, 'Invalid session', { code: 'SESSION_INVALID' });

/** Storefront-only conflicts on top of the shared ones. */
const STOREFRONT_CONFLICT_CODES = [...CONFLICT_CODES, 'ACTION_NOT_AVAILABLE', 'VERIFICATION_CONFLICT'];

const PAYMENT_STATUS: Partial<Record<EcommercePaymentError['code'], number>> = {
  STRIPE_NOT_CONFIGURED: 503,
  STOREFRONT_URL_MISSING: 503,
  STRIPE_UNREACHABLE: 502,
  STRIPE_REQUEST_FAILED: 502,
  NOTHING_DUE: 409,
  PAYMENT_PENDING: 409,
};

const EMAIL_STATUS: Record<EcommerceEmailError['code'], number> = {
  EMAIL_NOT_CONFIGURED: 503,
  EMAIL_SEND_FAILED: 502,
};

const MESSAGES: Record<number, string> = {
  409: 'Conflict',
  502: 'Upstream service failed',
  503: 'Service unavailable',
};

type Issue = { path: string; code: string; detail?: string; reason?: string };

const isPublicStatus = (s: string): s is PublicCodeStatus =>
  (PUBLIC_CODE_STATUSES as readonly string[]).includes(s);

/** Raw CodeStatus → public status; anything unknown → NOT_FOUND (never echoed). */
const publicStatus = (raw: unknown): PublicCodeStatus => {
  if (typeof raw !== 'string') return 'NOT_FOUND';
  const s = toPublicCodeStatus(raw as CodeStatus);
  return isPublicStatus(s) ? s : 'NOT_FOUND';
};

const ENTERED_CODE_PATH = /^promotionCodes\.\d+$/;

/**
 * Preflight C2: promotion refusals from order creation never leave as they are. A refusal on an
 * entered code goes to `promotionCodes.<i>` with the public status, and only a reached global
 * limit stays a 409 `PROMOTION_UNAVAILABLE`; a refusal of a promotion the customer did not
 * enter (automatic) keeps neither its id nor its code. Store-credit codes are made public.
 */
const toPublicIssue = (e: Issue, entered: string[]): Issue => {
  if (e.code.startsWith('STORE_CREDIT_')) {
    return { path: e.path, code: toPublicStoreCreditError(e.code) };
  }
  if (e.code === 'PROMOTION_CODE_INVALID') {
    return {
      path: ENTERED_CODE_PATH.test(e.path) ? e.path : 'promotionCodes',
      code: 'PROMOTION_CODE_INVALID',
      detail: publicStatus(e.detail),
    };
  }
  if (e.code === 'PROMOTION_UNAVAILABLE') {
    const code = typeof e.detail === 'string' ? normalizePromotionCode(e.detail) : '';
    const index = code ? entered.findIndex((c) => normalizePromotionCode(c) === code) : -1;
    if (index < 0) return { path: 'promotions', code: 'PROMOTION_UNAVAILABLE' };
    // The order service reports only "unavailable"; the storefront checkout adds the reason.
    const status = publicStatus(e.reason ?? 'USAGE_LIMIT_REACHED');
    return status === 'USAGE_LIMIT_REACHED'
      ? { path: `promotionCodes.${index}`, code: 'PROMOTION_UNAVAILABLE', detail: status }
      : { path: `promotionCodes.${index}`, code: 'PROMOTION_CODE_INVALID', detail: status };
  }
  const path = e.path.startsWith('promotions.') ? 'promotions' : e.path;
  return typeof e.detail === 'string' ? { path, code: e.code, detail: e.detail } : { path, code: e.code };
};

export type StorefrontErrorOptions = {
  /** `ORDER_NOT_FOUND` on order routes, `NOT_FOUND` on the catalog. */
  notFound: 'ORDER_NOT_FOUND' | 'NOT_FOUND';
  /** The codes as sent to the service, to put a refusal on its entered index. */
  promotionCodes?: string[];
  /** Seconds until the locked verification code expires (Retry-After of VERIFICATION_LOCKED). */
  lockedRetryAfterSec?: number;
  log?: { warn(message: string): void };
};

/**
 * Maps domain errors of the storefront services to HTTP responses; anything else is rethrown
 * (Strapi answers a generic 500 without details).
 */
export const handleStorefrontError = (ctx: any, err: unknown, opts: StorefrontErrorOptions): void => {
  if (err instanceof EcommerceValidationError) {
    const raw: Issue[] = err.errors.map((e: any) => ({
      path: typeof e?.path === 'string' ? e.path : '',
      code: typeof e?.code === 'string' ? e.code : 'invalid',
      ...(typeof e?.detail === 'string' ? { detail: e.detail } : {}),
      ...(typeof e?.reason === 'string' ? { reason: e.reason } : {}),
    }));
    if (raw.some((e) => e.code === 'SESSION_INVALID')) {
      opts.log?.warn(`${LOG_PREFIX} SESSION_INVALID`);
      return sendSessionInvalid(ctx);
    }
    if (raw.some((e) => e.code === 'VERIFICATION_LOCKED')) {
      return sendTooManyRequests(ctx, 'VERIFICATION_LOCKED', opts.lockedRetryAfterSec ?? 1);
    }
    const errors = raw.map((e) => toPublicIssue(e, opts.promotionCodes ?? []));
    const conflict = errors.find((e) => STOREFRONT_CONFLICT_CODES.includes(e.code));
    if (conflict) return sendError(ctx, 409, 'Invalid request', { code: conflict.code, errors });
    return sendError(ctx, 400, 'Invalid request', { code: errors[0]?.code ?? 'invalid', errors });
  }
  if (err instanceof EcommerceNotFoundError) {
    return sendError(ctx, 404, opts.notFound === 'ORDER_NOT_FOUND' ? 'Order not found' : 'Not found', {
      code: opts.notFound,
    });
  }
  if (err instanceof EcommercePaymentError) {
    const status = PAYMENT_STATUS[err.code];
    if (status) return sendError(ctx, status, MESSAGES[status], { code: err.code });
    throw err;
  }
  if (err instanceof EcommerceEmailError) {
    const status = EMAIL_STATUS[err.code];
    return sendError(ctx, status, MESSAGES[status], { code: err.code });
  }
  if (err instanceof EcommerceCarrierError) {
    return sendError(ctx, 502, MESSAGES[502], { code: err.code });
  }
  throw err;
};
