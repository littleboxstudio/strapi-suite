export const normalizeEmail = (email: string): string => String(email ?? '').trim().toLowerCase();

/** Pure format check: something@domain.tld, no whitespace. */
export const isValidEmailFormat = (raw: string): boolean =>
  typeof raw === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
