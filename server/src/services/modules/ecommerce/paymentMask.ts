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

/** Voucher-code shape `XXXX-XXXX-XXXX` (alphanumeric upper case) inside free text. */
const CODE_TOKEN = /\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g;

export const redactVoucherCodes = (text: string): string =>
  text.replace(CODE_TOKEN, (m) => `••••${m.slice(-4)}`);

/** History values: any `code` string (at any depth) is masked. Returns a copy. */
export const redactHistoryValue = (v: unknown): any => {
  if (Array.isArray(v)) return v.map(redactHistoryValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        k === 'code' && typeof x === 'string' ? maskStoreCreditCode(x) : redactHistoryValue(x),
      ])
    );
  }
  return v ?? null;
};
