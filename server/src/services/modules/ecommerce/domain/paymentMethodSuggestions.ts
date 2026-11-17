/**
 * Manual payment method suggestions (Add payment): two texts are the same method when they
 * match lowercase with every whitespace removed ("MB Way" = "mbway" = "M B  WAY").
 */
export const paymentMethodKey = (text: string): string =>
  typeof text === 'string' ? text.toLowerCase().replace(/\s+/g, '') : '';

/**
 * Trimmed, non-blank names deduplicated by `paymentMethodKey` (the first spelling seen wins,
 * so list the preferred source first), sorted case-insensitively.
 */
export const mergePaymentMethodNames = (...sources: unknown[][]): string[] => {
  const byKey = new Map<string, string>();
  for (const source of sources) {
    for (const raw of source) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      const key = paymentMethodKey(name);
      if (key && !byKey.has(key)) byKey.set(key, name);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
};
