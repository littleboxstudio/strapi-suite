/** Upper bound for any money amount an admin enters, in cents (mirrors the server). */
export const MAX_MONEY_CENTS = 1_000_000_000;

export function formatCents(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function parseMoneyToCents(input: string): number | null {
  const s = input.replace(/[\s €]/g, '');
  if (!/^\d+([.,]\d+)*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let intPart = s;
  let decPart = '';
  if (lastSep !== -1) {
    intPart = s.slice(0, lastSep);
    decPart = s.slice(lastSep + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (decPart.length > 2) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0') || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Decimal amount in the admin's locale, without currency or grouping (e.g. "17,50"): form defaults. */
export function formatAmountInput(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(Math.max(0, cents) / 100);
}
