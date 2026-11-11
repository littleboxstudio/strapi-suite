import type { FieldError } from './domain/catalog';

/** A field-level validation problem. `code` is a stable identifier the admin translates. */
export type ValidationIssue = FieldError | { path: string; code: string; detail?: string };

export class EcommerceValidationError extends Error {
  name = 'EcommerceValidationError';

  constructor(
    message: string,
    public errors: ValidationIssue[]
  ) {
    super(message);
  }
}

export class EcommerceNotFoundError extends Error {
  name = 'EcommerceNotFoundError';
}

export class EcommerceSecretError extends Error {
  name = 'EcommerceSecretError';

  constructor(public code: 'ENCRYPTION_KEY_MISSING' | 'SECRET_UNREADABLE') {
    super(code);
  }
}

/** E-mail delivery problem. The message never contains secrets or provider responses. */
export class EcommerceEmailError extends Error {
  name = 'EcommerceEmailError';

  constructor(
    public code: 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED',
    message: string = code
  ) {
    super(message);
  }
}

/** Payment-provider problem. The message never contains secrets, URLs or provider response bodies. */
export class EcommercePaymentError extends Error {
  name = 'EcommercePaymentError';

  constructor(
    public code:
      | 'STRIPE_NOT_CONFIGURED'
      | 'STRIPE_REQUEST_FAILED'
      | 'STRIPE_UNREACHABLE'
      | 'NOTHING_DUE'
      | 'STOREFRONT_URL_MISSING'
      /** A Stripe payment (e.g. Multibanco) awaits confirmation: no new link meanwhile. */
      | 'PAYMENT_PENDING'
      /** A Stripe session does not match the stored session or payment (id or amount). */
      | 'STRIPE_SESSION_MISMATCH'
      /** Missing/invalid `Stripe-Signature`, or no webhook secret configured. */
      | 'WEBHOOK_SIGNATURE_INVALID'
      /** Correctly signed, but not a Stripe event (no `id`/`type`). */
      | 'WEBHOOK_PAYLOAD_INVALID',
    message: string = code,
    /** Stripe's `error.type` (e.g. `idempotency_error`), never its message. */
    public stripeErrorType?: string,
    /** The HTTP status of Stripe's answer, when Stripe answered. */
    public httpStatus?: number
  ) {
    super(message);
  }
}

/** Carrier problem. The message never contains secrets, URLs or carrier response bodies. */
export class EcommerceCarrierError extends Error {
  name = 'EcommerceCarrierError';

  constructor(
    public code:
      | 'CARRIER_NOT_CONFIGURED'
      | 'NOT_IMPLEMENTED'
      | 'NOT_SUPPORTED'
      | 'CARRIER_REQUEST_FAILED'
      | 'CARRIER_UNREACHABLE'
      | 'TIMEOUT'
      | 'INVALID_QUOTE',
    message: string = code,
    /** True when the carrier may have processed the request (the outcome is unknown). */
    public uncertain: boolean = false
  ) {
    super(message);
  }
}

/** Billing-provider problem. The message never contains secrets, URLs or provider response bodies. */
export class EcommerceBillingError extends Error {
  name = 'EcommerceBillingError';

  constructor(
    public code:
      | 'BILLING_NOT_CONFIGURED'
      | 'BILLING_PROVIDER_AMBIGUOUS'
      | 'BILLING_AUTH_FAILED'
      | 'BILLING_REQUEST_FAILED'
      | 'BILLING_UNREACHABLE'
      | 'BILLING_CONFIG_MISSING'
      | 'BILLING_TAX_NOT_FOUND'
      | 'BILLING_EXEMPTION_REASON_MISSING'
      | 'NOT_SUPPORTED'
      | 'NOTHING_TO_INVOICE'
      | 'INVOICE_PDF_UNAVAILABLE',
    message: string = code,
    /** True when the provider may have processed the request (the outcome is unknown). */
    public uncertain: boolean = false
  ) {
    super(message);
  }
}
