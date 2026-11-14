/**
 * Manual per-line discount (spec 4.1): parsing and display of the percent an admin types on an
 * order line. Leaf module (no imports): used by the products editor, the new-order form and the
 * percent of a manual order discount.
 */

/** Most integer digits a percent field takes ("100"). */
const PERCENT_MAX_INT_DIGITS = 3;

/**
 * The percent typed in a line's text field: digits and one decimal separator (a comma or a dot),
 * at most 2 decimals and 3 integer digits. The range is checked by {@link parseDiscountPercent}.
 */
export function discountPercentFromInput(raw: string): string {
  let out = '';
  let separator = false;
  let decimals = 0;
  let digits = 0;
  for (const ch of raw) {
    if (/\d/.test(ch)) {
      if (separator) {
        if (decimals >= 2) continue;
        decimals += 1;
      } else {
        if (digits >= PERCENT_MAX_INT_DIGITS) continue;
        digits += 1;
      }
      out += ch;
    } else if ((ch === ',' || ch === '.') && !separator && digits > 0) {
      separator = true;
      out += ch;
    }
  }
  return out;
}

/** A typed percent: empty = none; otherwise 0 < p ≤ 100 with at most 2 decimals. */
export function parseDiscountPercent(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return { ok: false };
  const value = Number(text.replace(',', '.'));
  return value > 0 && value <= 100 ? { ok: true, value } : { ok: false };
}

/** round(unit price × p / 100) in cents, half up, as the server computes it. */
export function lineUnitDiscount(unitPrice: number, percent: number): number {
  const basis = Math.round(percent * 100);
  return Math.min(unitPrice, Math.floor((unitPrice * basis + 5000) / 10000));
}

/** The locale's decimal separator, always with Latin digits (the field takes only 0-9). */
const percentNumber = (percent: number, locale: string) =>
  new Intl.NumberFormat(locale || 'en', {
    maximumFractionDigits: 2,
    useGrouping: false,
    numberingSystem: 'latn',
  } as Intl.NumberFormatOptions).format(percent);

/** "−10 %": the manual discount shown on a line. */
export function formatLineDiscount(percent: number, locale: string): string {
  return `\u2212${percentNumber(percent, locale)} %`;
}

/** A stored percent as the text of its field (the locale's decimal separator); '' for none. */
export function percentToInput(percent: number | null, locale: string): string {
  return percent === null ? '' : percentNumber(percent, locale);
}
