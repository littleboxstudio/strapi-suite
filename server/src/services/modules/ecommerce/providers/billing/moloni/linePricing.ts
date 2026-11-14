/**
 * Moloni line prices (pure; no Strapi imports). A line is sent with its price before discounts
 * and the discount as a percentage (Moloni's `discount`, 0–100), so the document shows it. The
 * percentage goes with 2 decimal places; it is only used when it gives the same cents as the
 * discounted price, line by line and for the whole document. Otherwise every line goes as before:
 * the discounted price, no percentage (the total never changes).
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
  return sameCents(total(plain), total(shown)) ? shown : plain;
}
