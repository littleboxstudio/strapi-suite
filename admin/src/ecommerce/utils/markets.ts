/** List helpers for the Markets table (Settings → General → Region). Codes are ISO-2 country codes. */

/** Adds one country; a blank or already listed code leaves the list as it is. */
export function addMarket(markets: string[], code: string): string[] {
  if (!code || markets.includes(code)) return markets;
  return [...markets, code];
}

/** Adds every country of `all` that is not listed yet, keeping the existing ones first. */
export function addAllMarkets(markets: string[], all: string[]): string[] {
  const missing = all.filter((code) => !markets.includes(code));
  return missing.length === 0 ? markets : [...markets, ...missing];
}

/** Removes one country. */
export function removeMarket(markets: string[], code: string): string[] {
  return markets.filter((c) => c !== code);
}

/** Table rows: the listed countries with their display name, sorted by name. */
export function marketRows(
  markets: string[],
  countries: { code: string; name: string }[],
  locale: string
): { code: string; name: string }[] {
  const names = new Map(countries.map((c) => [c.code, c.name]));
  return markets
    .map((code) => ({ code, name: names.get(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
