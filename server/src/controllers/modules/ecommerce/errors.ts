import {
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../services/modules/ecommerce/errors';

/**
 * Maps e-commerce domain errors to HTTP responses; rethrows anything else.
 * Messages never include secrets or provider responses.
 */
export const handleDomainError = (
  ctx: any,
  err: unknown,
  labels: { invalid: string; notFound: string }
) => {
  if (err instanceof EcommerceValidationError) {
    return ctx.badRequest(labels.invalid, { errors: err.errors });
  }
  if (err instanceof EcommerceNotFoundError) {
    return ctx.notFound(labels.notFound);
  }
  if (err instanceof EcommerceSecretError || err instanceof EcommerceEmailError) {
    return ctx.badRequest(err.message, { code: err.code });
  }
  throw err;
};
