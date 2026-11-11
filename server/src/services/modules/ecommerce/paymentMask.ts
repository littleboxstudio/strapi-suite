/**
 * What an admin with only the orders permission may see of a payment. A STORE_CREDIT payment
 * keeps the full voucher code as its `reference`: it is shown masked (`••••ABCD`) with the
 * store credit id; the code itself stays behind the store credit endpoints.
 */
export const maskStoreCreditCode = (code: unknown): string | null =>
  typeof code === 'string' && code ? `••••${code.slice(-4)}` : null;

export const paymentReferenceOf = (p: any): string | null =>
  p?.method === 'STORE_CREDIT' ? maskStoreCreditCode(p.reference) : (p?.reference ?? null);

export const storeCreditIdOf = (p: any): number | null => {
  if (p?.method !== 'STORE_CREDIT') return null;
  const id = Number(p.metadata?.storeCreditId);
  return Number.isInteger(id) && id > 0 ? id : null;
};
