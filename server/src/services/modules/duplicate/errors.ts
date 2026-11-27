/** Why a duplication request is refused; the controller maps the code to the HTTP answer. */
export type DuplicateErrorCode = 'invalid_locale' | 'invalid_option' | 'RUN_IN_PROGRESS';

export class DuplicateError extends Error {
  constructor(public readonly code: DuplicateErrorCode) {
    super(code);
    this.name = 'DuplicateError';
  }
}
