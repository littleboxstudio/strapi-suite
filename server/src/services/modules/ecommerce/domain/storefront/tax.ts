/**
 * VAT breakdown of VAT-inclusive amounts (integer cents).
 */
import { allocateProportionally } from '../orders';

export type VatRow = { rate: number; base: number; vat: number; gross: number };

/** Rates have at most 2 decimals: work in basis points so the maths stays integer. */
const toBasisPoints = (rate: number): number => Math.round(rate * 100);

/** Round half up of gross × 10000 / (10000 + bp), exact with BigInt. */
const baseOf = (gross: number, bp: number): number => {
  const num = BigInt(gross) * BigInt(20000) + BigInt(10000 + bp);
  return Number(num / (BigInt(10000 + bp) * BigInt(2)));
};

export const vatBreakdown = (items: { amount: number; rate: number }[]): VatRow[] => {
  const grossByBp = new Map<number, number>();
  for (const { amount, rate } of items) {
    const bp = toBasisPoints(rate);
    grossByBp.set(bp, (grossByBp.get(bp) ?? 0) + amount);
  }
  return [...grossByBp.entries()]
    .filter(([, gross]) => gross !== 0)
    .sort(([a], [b]) => a - b)
    .map(([bp, gross]) => {
      const base = baseOf(gross, bp);
      return { rate: bp / 100, base, vat: gross - base, gross };
    });
};

export const quoteVatItems = (q: {
  lines: { unitPrice: number; unitDiscount: number; quantity: number; tax: number }[];
  orderDiscount: number;
  shippingTotal: number | null;
  shippingTax: number | null;
}): { amount: number; rate: number }[] => {
  const amounts = q.lines.map((l) => (l.unitPrice - l.unitDiscount) * l.quantity);
  const shares = allocateProportionally(q.orderDiscount, amounts);
  const items = q.lines.map((l, i) => ({ amount: amounts[i] - shares[i], rate: l.tax }));
  if (q.shippingTotal !== null && q.shippingTax !== null) {
    items.push({ amount: q.shippingTotal, rate: q.shippingTax });
  }
  return items;
};
