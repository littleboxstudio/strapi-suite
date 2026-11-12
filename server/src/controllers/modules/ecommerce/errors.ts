import {
  EcommerceBillingError,
  EcommerceCarrierError,
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../services/modules/ecommerce/errors';

/** Validation codes that mean "the request clashes with current state": HTTP 409. */
export const CONFLICT_CODES = [
  'IDEMPOTENCY_KEY_CONFLICT',
  'STORE_CREDIT_CONFLICT',
  'QUANTITY_EXCEEDS_PENDING',
  'QUANTITY_EXCEEDS_RETURNABLE',
  'ALREADY_DELIVERED',
  'PAYMENT_NOT_INVOICEABLE',
  'SHIPMENT_PENDING',
  'SHIPMENT_UNCERTAIN',
  'SHIPMENT_HAS_RETURNS',
  'ORDER_CHANGED',
  'SHIPMENT_STATE_CHANGED',
  'PROMOTION_UNAVAILABLE',
  'STORE_CREDIT_INSUFFICIENT',
  'TOTAL_CHANGED',
  'PROMOTION_IN_USE',
  'PROMOTION_VERSION_CONFLICT',
  'MARKET_IN_USE',
  'STOREFRONT_TOKEN_EXISTS',
  'PRODUCT_IN_ORDERS',
];

/**
 * Maps e-commerce domain errors to HTTP responses; rethrows anything else.
 * Messages never include secrets or provider responses.
 */
export const handleDomainError = (
  ctx: any,
  err: unknown,
  labels: { invalid: string; notFound: string; withCode?: boolean }
) => {
  if (err instanceof EcommerceValidationError) {
    const codes = err.errors
      .map((e) => (e && typeof (e as any).code === 'string' ? ((e as any).code as string) : undefined))
      .filter((c): c is string => !!c);
    const conflict = codes.find((c) => CONFLICT_CODES.includes(c));
    const code = conflict ?? codes[0];
    if (conflict) {
      ctx.status = 409;
      ctx.body = {
        data: null,
        error: {
          status: 409,
          name: 'ConflictError',
          message: labels.invalid,
          details: { code: conflict, errors: err.errors },
        },
      };
      return;
    }
    return ctx.badRequest(
      labels.invalid,
      labels.withCode && code ? { code, errors: err.errors } : { errors: err.errors }
    );
  }
  if (
    err instanceof EcommercePaymentError ||
    err instanceof EcommerceCarrierError ||
    err instanceof EcommerceBillingError
  ) {
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
