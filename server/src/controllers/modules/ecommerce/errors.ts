import {
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../services/modules/ecommerce/errors';

/**
 * Maps e-commerce domain errors to HTTP responses; rethrows anything else.
 * Messages never include secrets or provider responses.
 */
/** Validation codes that mean "the request clashes with current state": HTTP 409. */
const CONFLICT_CODES = ['IDEMPOTENCY_KEY_CONFLICT', 'STORE_CREDIT_CONFLICT'];

export const handleDomainError = (
  ctx: any,
  err: unknown,
  labels: { invalid: string; notFound: string; withCode?: boolean }
) => {
  if (err instanceof EcommerceValidationError) {
    const code = err.errors.find((e) => e && typeof (e as any).code === 'string')?.code;
    if (code && CONFLICT_CODES.includes(code)) {
      ctx.status = 409;
      ctx.body = {
        data: null,
        error: {
          status: 409,
          name: 'ConflictError',
          message: labels.invalid,
          details: { code, errors: err.errors },
        },
      };
      return;
    }
    return ctx.badRequest(
      labels.invalid,
      labels.withCode && code ? { code, errors: err.errors } : { errors: err.errors }
    );
  }
  if (err instanceof EcommercePaymentError) {
    return ctx.badRequest(err.message, { code: err.code });
  }
  if (err instanceof EcommerceNotFoundError) {
    return ctx.notFound(labels.notFound);
  }
  if (err instanceof EcommerceSecretError || err instanceof EcommerceEmailError) {
    return ctx.badRequest(err.message, { code: err.code });
  }
  throw err;
};
