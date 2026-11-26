export type Peppers = { current: number; byVersion: Map<number, Buffer>; invalid: number };

const NAME = /^LTB_ECOMMERCE_PASSWORD_PEPPER_V([1-9]\d*)$/;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

const scan = (env: Record<string, string | undefined>) => {
  const byVersion = new Map<number, Buffer>();
  let invalid = 0;
  for (const [key, raw] of Object.entries(env)) {
    const m = NAME.exec(key);
    if (!m) continue;
    const value = typeof raw === 'string' ? raw.trim() : '';
    const bytes = value && BASE64.test(value) ? Buffer.from(value, 'base64') : null;
    if (!bytes || bytes.length < 32) {
      invalid += 1;
      continue;
    }
    byVersion.set(Number(m[1]), bytes);
  }
  return { byVersion, invalid };
};

/** How many `LTB_ECOMMERCE_PASSWORD_PEPPER_V<n>` variables are set but unusable (short or not base64). */
export const countInvalidPeppers = (env: Record<string, string | undefined>): number => scan(env).invalid;

/**
 * Reads `LTB_ECOMMERCE_PASSWORD_PEPPER_V<n>` (n >= 1, base64, at least 32 bytes decoded). The
 * current version is the highest n. Invalid values are ignored and counted; null when none is
 * valid. Pure: it never logs.
 */
export const readPeppers = (env: Record<string, string | undefined>): Peppers | null => {
  const { byVersion, invalid } = scan(env);
  if (!byVersion.size) return null;
  return { current: Math.max(...byVersion.keys()), byVersion, invalid };
};
