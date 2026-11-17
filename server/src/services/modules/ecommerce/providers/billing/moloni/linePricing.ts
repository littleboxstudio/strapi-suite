/**
 * Moloni line prices (pure; no Strapi imports). A line is sent with its price before discounts
 * (`grossTotal`) and one discount percentage (Moloni's `discount`, 0–100, 2 decimal places) that
 * combines its own discount and its share of the order or shipping discounts (`discountShare`):
 * `1 − total / grossTotal`. The percentage is only used when it gives the line's exact cents;
 * where it cannot (or the document sum would differ), only that line falls back to its discounted
 * unit price with no percentage, so the total never changes. A short note names the parts.
 */
import type { InvoiceLine } from '../../../domain/invoicing';

export type MoloniLinePrice = { price: number; discount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Unit price without VAT, in euros, 4 decimal places, of `cents` (VAT included) for the line. */
const unitPrice = (cents: number, line: Pick<InvoiceLine, 'tax' | 'quantity'>) =>
  round4((cents * 100) / (100 + line.tax) / line.quantity / 100);

/** Net unit price in euros of what the line charges (its discounted value). */
export const netUnitPrice = (line: Pick<InvoiceLine, 'total' | 'tax' | 'quantity'>) =>
  unitPrice(line.total, line);

/** Unit price before discounts, for a line that carries one (`grossTotal` > `total`). */
export const grossUnitPrice = (line: Pick<InvoiceLine, 'total' | 'grossTotal' | 'tax' | 'quantity'>) =>
  line.grossTotal != null && line.grossTotal > line.total ? unitPrice(line.grossTotal, line) : netUnitPrice(line);

type Amounts = { net: number; gross: number };

const amountsOf = (qty: number, price: number, discount: number, tax: number): Amounts => {
  const net = qty * price * (1 - discount / 100);
  return { net, gross: net * (1 + tax / 100) };
};

const sameCents = (a: Amounts, b: Amounts) =>
  round2(a.net) === round2(b.net) && round2(a.gross) === round2(b.gross);

/** Price and discount of each line, in draft order. */
export function moloniLinePrices(lines: InvoiceLine[]): MoloniLinePrice[] {
  const plain = lines.map((l) => ({ price: netUnitPrice(l), discount: 0 }));
  const shown = lines.map((l, i) => {
    if (!(l.grossTotal != null && l.grossTotal > l.total && l.quantity > 0)) return plain[i];
    const price = grossUnitPrice(l);
    if (!(price > 0)) return plain[i];
    const discount = Math.min(100, Math.max(0, round2((1 - plain[i].price / price) * 100)));
    if (discount <= 0) return plain[i];
    const before = amountsOf(l.quantity, plain[i].price, 0, l.tax);
    const after = amountsOf(l.quantity, price, discount, l.tax);
    return sameCents(before, after) ? { price, discount } : plain[i];
  });
  const total = (prices: MoloniLinePrice[]) =>
    lines.reduce<Amounts>(
      (acc, l, i) => {
        const a = amountsOf(l.quantity, prices[i].price, prices[i].discount, l.tax);
        return { net: acc.net + a.net, gross: acc.gross + a.gross };
      },
      { net: 0, gross: 0 }
    );
  // Document exactness: if the sums still differ, drop the percentage line by line (not for all).
  const reference = total(plain);
  const result = [...shown];
  for (let i = 0; i < result.length && !sameCents(reference, total(result)); i++) {
    if (result[i].discount > 0) result[i] = plain[i];
  }
  return result;
}

const fmtPercent = (n: number) => String(round2(n)).replace('.', ',');
const fmtEuros = (cents: number) =>
  `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/**
 * Note of a line with discounts, in Portuguese: its own discount (% of the price before
 * discounts) and its share of the order discounts (euros), or of the shipping discounts on a
 * SHIPPING line. `null` when it has neither.
 */
export function moloniLineNote(
  line: Pick<InvoiceLine, 'total' | 'grossTotal' | 'discountShare'> & { kind?: InvoiceLine['kind'] }
): string | null {
  const share = line.discountShare && line.discountShare > 0 ? line.discountShare : 0;
  const gross = line.grossTotal ?? 0;
  const own = gross > 0 ? gross - line.total - share : 0;
  const parts: string[] = [];
  if (own > 0) parts.push(`Desconto da linha ${fmtPercent((own / gross) * 100)}%`);
  if (share > 0) {
    parts.push(`${line.kind === 'SHIPPING' ? 'Desconto dos portes' : 'Desconto da encomenda'} ${fmtEuros(share)}`);
  }
  return parts.length ? parts.join(' + ') : null;
}

/**
 * Where the note goes: Moloni's product `summary`. If a draft shows Moloni drops it, set this to
 * 'name' and the note becomes a suffix of the product name (`name — note`).
 */
export const NOTE_TARGET: 'summary' | 'name' = 'summary';
