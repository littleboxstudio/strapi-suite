/** A request the image field refuses. `code` is stable; the admin translates it. */
export class ImageFieldValidationError extends Error {
  name = 'ImageFieldValidationError';

  constructor(public code: string) {
    super(code);
  }
}

export class ImageFieldNotFoundError extends Error {
  name = 'ImageFieldNotFoundError';
}
