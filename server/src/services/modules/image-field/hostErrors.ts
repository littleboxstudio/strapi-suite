import path from 'path';
import { createRequire } from 'module';

type ValidationErrorClass = new (message: string, details?: unknown) => Error;

/** Used only when the host's class cannot be found: still refuses the value (as a 500). */
class FallbackValidationError extends Error {
  name = 'ValidationError';

  constructor(
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

let cached: ValidationErrorClass | null = null;

/**
 * Strapi's `errors.ValidationError`, the very class its error middleware checks with `instanceof`
 * (answered as a 400). `@strapi/utils` is not a dependency of this plugin and must not be bundled,
 * so it is resolved at runtime from the host's `@strapi/core` (through `@strapi/strapi`).
 */
export function hostValidationError(): ValidationErrorClass {
  if (cached) return cached;
  const bases = [path.join(process.cwd(), 'package.json')];
  if (typeof __filename === 'string') bases.push(__filename);
  for (const base of bases) {
    try {
      const fromBase = createRequire(base);
      const fromStrapi = createRequire(fromBase.resolve('@strapi/strapi'));
      const fromCore = createRequire(fromStrapi.resolve('@strapi/core'));
      const utils = fromCore('@strapi/utils');
      const cls = utils?.errors?.ValidationError;
      if (typeof cls === 'function') {
        cached = cls;
        return cls;
      }
    } catch {
      // Try the next base.
    }
  }
  cached = FallbackValidationError;
  return cached;
}
