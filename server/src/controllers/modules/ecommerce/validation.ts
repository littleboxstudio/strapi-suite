import { EcommerceValidationError } from '../../../services/modules/ecommerce/errors';
import { MAX_MONEY_CENTS } from '../../../services/modules/ecommerce/domain/orders';

/** Request-body checks shared by the e-commerce admin controllers. They throw validation errors. */
export const MAX_SHORT = 255;
export const MAX_LONG = 5000;
/**
 * Client idempotency keys: the services add prefixes/suffixes (`admin-issue:`, `refund:…:<paymentId>`),
 * and the columns and Stripe's Idempotency-Key are 255 characters, so the client part stops at 200.
 */
export const MAX_KEY = 200;

export const fail = (message: string, path: string, code: string): never => {
  throw new EcommerceValidationError(message, [{ path, code }]);
};

export const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Integer cents, 1..MAX_MONEY_CENTS. */
export const cents = (message: string, path: string, v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_MONEY_CENTS) {
    return fail(message, path, 'invalid_amount');
  }
  return v;
};

export const requiredString = (message: string, path: string, v: unknown, max = MAX_SHORT): string => {
  if (typeof v !== 'string' || !v.trim()) return fail(message, path, 'required');
  if (v.length > max) return fail(message, path, 'too_long');
  return v;
};

/** `undefined`/`null`/'' → undefined; a non-string or too long value → error. */
export const optionalString = (
  message: string,
  path: string,
  v: unknown,
  max = MAX_SHORT
): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') return fail(message, path, 'invalid');
  if (v.length > max) return fail(message, path, 'too_long');
  return v;
};

export const positiveInt = (message: string, path: string, v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail(message, path, 'invalid');
  return v;
};

/** Integer cents, 0..MAX_MONEY_CENTS. */
export const nonNegativeCents = (message: string, path: string, v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_MONEY_CENTS) {
    return fail(message, path, 'invalid_amount');
  }
  return v;
};

/** `undefined`/`null` → `fallback`; anything but a boolean → error. */
export const optionalBoolean = (message: string, path: string, v: unknown, fallback: boolean): boolean => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') return fail(message, path, 'invalid');
  return v;
};

/** `undefined` stays undefined (unchanged), `null` clears, otherwise a string up to `max`. */
export const nullableString = (
  message: string,
  path: string,
  v: unknown,
  max = MAX_SHORT
): string | null | undefined => {
  if (v === undefined || v === null) return v as undefined | null;
  if (typeof v !== 'string') return fail(message, path, 'invalid');
  if (v.length > max) return fail(message, path, 'too_long');
  return v;
};

/** An array of objects, at most `max` entries and not empty. */
export const objectList = (message: string, path: string, v: unknown, max = 200): Record<string, unknown>[] => {
  if (!Array.isArray(v) || v.length < 1) return fail(message, path, 'required');
  if (v.length > max) return fail(message, path, 'too_long');
  return v.map((item) => asObject(item));
};

/** Order-line quantities: `[{ orderLineId, quantity }]`, plus a boolean `restock` for returns. */
export const lineQuantities = (message: string, raw: unknown, withRestock: boolean) =>
  objectList(message, 'lines', raw).map((l, i) => ({
    orderLineId: positiveInt(message, `lines.${i}.orderLineId`, l.orderLineId),
    quantity: positiveInt(message, `lines.${i}.quantity`, l.quantity),
    ...(withRestock
      ? {
          restock:
            typeof l.restock === 'boolean' ? l.restock : fail(message, `lines.${i}.restock`, 'invalid'),
        }
      : {}),
  }));
