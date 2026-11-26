export type Peppers = { current: number; byVersion: Map<number, Buffer> };

const NAME = /^LTB_ECOMMERCE_PASSWORD_PEPPER_V(\d+)$/;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Reads `LTB_ECOMMERCE_PASSWORD_PEPPER_V<n>` (base64, at least 32 bytes decoded). The current
 * version is the highest n. Invalid values are ignored; null when none is valid.
 */
export const readPeppers = (env: Record<string, string | undefined>): Peppers | null => {
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
  if (invalid > 0) {
    // Codes and counts only, never the values.
    console.warn(`[ecommerce] ${invalid} invalid password pepper variable(s) ignored (PEPPER_INVALID)`);
  }
  if (!byVersion.size) return null;
  return { current: Math.max(...byVersion.keys()), byVersion };
};
