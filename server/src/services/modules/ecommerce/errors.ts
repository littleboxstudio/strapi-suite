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
