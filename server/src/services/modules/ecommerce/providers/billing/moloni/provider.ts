import type { ProviderRuntime } from '../../registry';
import { str, timedFetch } from '../../http';
import { EcommerceBillingError } from '../../../errors';
import type { BillingProvider, InvoiceDraft, InvoiceLine, IssuedDocument } from '../types';
import { createMoloniClient, describeShape } from './client';

/**
 * Moloni billing provider (design 4.15), built from the public API docs and NOT verified against
 * a live account. Foreign customers are issued like domestic ones (see ecommerce-followups.md).
 */

const LOOKUP_TTL_MS = 60 * 60 * 1000;
const PDF_TIMEOUT_MS = 15000;
const PDF_MAX_BYTES = 10 * 1024 * 1024;
/** Portuguese "Consumidor Final": used when the customer has no NIF (a NIF is never invented). */
const CONSUMER_VAT = '999999990';
const DEFAULT_SHIPPING_REFERENCE = 'PORTES';
const UNKNOWN = 'Desconhecido';

/** Lookup lists cached per company (`<companyId>:<path>`) for 1 h. */
let lookups = new Map<string, { at: number; list: any[] }>();

export function __resetMoloniLookupsForTests(): void {
  lookups = new Map();
}

const euros = (cents: number) => cents / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Net unit price in euros: total × 100 / (100 + tax) / quantity / 100, 4 decimal places. */
const netUnitPrice = (line: InvoiceLine) => round4((line.total * 100) / (100 + line.tax) / line.quantity / 100);

function configuredId(rt: ProviderRuntime, key: string): number | null {
  const n = Number(str(rt, key));
  return str(rt, key) && Number.isInteger(n) && n > 0 ? n : null;
}

const requestFailed = (message: string, uncertain = false) =>
  new EcommerceBillingError('BILLING_REQUEST_FAILED', message, uncertain);

function documentId(externalId: string): number {
  const n = Number(externalId);
  if (!Number.isInteger(n) || n <= 0) throw requestFailed('Invalid Moloni document id.');
  return n;
}

function context(rt: ProviderRuntime) {
  const client = createMoloniClient(rt);
  const companyId = client.companyId; // validates the required settings first

  async function list(path: string): Promise<any[]> {
    const key = `${companyId}:${path}`;
    const hit = lookups.get(key);
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.list;
    const body = await client.call<unknown>(path);
    const items = Array.isArray(body) ? body : [];
    if (!items.length) throw new EcommerceBillingError('BILLING_CONFIG_MISSING', `Moloni returned no entries for ${path}.`);
    lookups.set(key, { at: Date.now(), list: items });
    return items;
  }

  /** The configured id, or the first one Moloni returns. */
  async function idOf(configKey: string, path: string, idField: string): Promise<number> {
    const configured = configuredId(rt, configKey);
    if (configured) return configured;
    const id = Number((await list(path))[0]?.[idField]);
    if (!Number.isInteger(id) || id <= 0) {
      throw new EcommerceBillingError('BILLING_CONFIG_MISSING', `Moloni returned no usable entry for ${path}.`);
    }
    return id;
  }

  /** Prefers the Portuguese VAT tax with this rate (`fiscal_zone` PT, `saft_type` IVA), else the first match. */
  async function taxId(rate: number): Promise<number> {
    const matches = (await list('taxes/getAll')).filter((t) => Number(t?.value) === rate);
    const isPt = (t: any) => String(t?.fiscal_zone ?? '').toUpperCase() === 'PT';
    const isVat = (t: any) => ['1', 'IVA'].includes(String(t?.saft_type ?? '').toUpperCase());
    const tax = matches.find((t) => isPt(t) && isVat(t)) ?? matches[0];
    if (!tax) throw new EcommerceBillingError('BILLING_TAX_NOT_FOUND', `No Moloni tax with rate ${rate}%.`);
    return Number(tax.tax_id);
  }

  async function countryId(iso2: string): Promise<number> {
    const countries = await list('countries/getAll');
    const find = (code: string) => countries.find((c) => String(c?.iso_3166_1 ?? '').toLowerCase() === code.toLowerCase());
    const country = (iso2 && find(iso2)) || find('PT');
    if (!country) throw new EcommerceBillingError('BILLING_CONFIG_MISSING', 'Moloni returned no matching country.');
    return Number(country.country_id);
  }

  return { client, idOf, taxId, countryId };
}

type Ctx = ReturnType<typeof context>;

async function customerId(ctx: Ctx, draft: InvoiceDraft, paymentMethodId: () => Promise<number>): Promise<number> {
  const nif = draft.customer.nif?.trim() || null;
  const vat = nif ?? CONSUMER_VAT;
  const found = await ctx.client.call<any>('customers/getByVat', { vat });
  const hit = Array.isArray(found) ? found.find((c) => Number(c?.customer_id) > 0) : null;
  if (hit) return Number(hit.customer_id);

  const next = await ctx.client.call<any>('customers/getNextNumber');
  const c = draft.customer;
  const identity = nif
    ? {
        name: c.name || UNKNOWN,
        address: c.address || UNKNOWN,
        zip_code: c.postalCode || '0000-000',
        city: c.city || UNKNOWN,
        country_id: await ctx.countryId(c.country),
        email: c.email || '',
      }
    : { name: 'Consumidor Final', address: UNKNOWN, zip_code: '0000-000', city: UNKNOWN, country_id: await ctx.countryId('PT'), email: '' };
  const res = await ctx.client.call<any>(
    'customers/insert',
    {
      vat,
      number: String(next?.number ?? ''),
      ...identity,
      language_id: draft.locale.toLowerCase().startsWith('pt') ? 1 : 2,
      maturity_date_id: 0,
      payment_method_id: await paymentMethodId(),
      salesman_id: 0,
      payment_day: 0,
      discount: 0,
      credit_limit: 0,
      delivery_method_id: 0,
    }
    // Not a document write: a lost answer leaves no document behind, so the outcome stays certain.
  );
  const id = Number(res?.customer_id);
  if (!Number.isInteger(id) || id <= 0) throw requestFailed('Moloni did not return the new customer id.');
  return id;
}

type LineTax = { taxes: { tax_id: number }[] } | { exemption_reason: string };

async function productId(ctx: Ctx, line: InvoiceLine, reference: string, tax: LineTax): Promise<number> {
  const found = await ctx.client.call<any>('products/getByReference', { reference, exact: 1 });
  const hit = Array.isArray(found) ? found.find((p) => Number(p?.product_id) > 0) : null;
  if (hit) return Number(hit.product_id);

  const res = await ctx.client.call<any>(
    'products/insert',
    {
      category_id: await ctx.idOf('productCategoryId', 'productCategories/getAll', 'category_id'),
      type: line.kind === 'SHIPPING' ? 2 : 1,
      name: line.name,
      reference,
      price: netUnitPrice(line),
      unit_id: await ctx.idOf('measurementUnitId', 'measurementUnits/getAll', 'unit_id'),
      has_stock: 0,
      ...('taxes' in tax
        ? { taxes: tax.taxes.map((t) => ({ tax_id: t.tax_id, value: line.tax, order: 1, cumulative: 0 })) }
        : tax),
    }
    // Not a document write: a lost answer leaves no document behind, so the outcome stays certain.
  );
  const id = Number(res?.product_id);
  if (!Number.isInteger(id) || id <= 0) throw requestFailed('Moloni did not return the new product id.');
  return id;
}

function toIssued(doc: any, externalId: string, fallback: { documentType: string; date: string }): IssuedDocument {
  const series = typeof doc?.document_set_name === 'string' && doc.document_set_name ? doc.document_set_name : null;
  const number = doc?.number == null ? '' : String(doc.number);
  const total = Number.isFinite(Number(doc?.net_value)) && doc?.net_value != null ? Math.round(Number(doc.net_value) * 100) : null;
  const date = typeof doc?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(doc.date) ? doc.date.slice(0, 10) : fallback.date;
  const saft = doc?.document_type?.saft_code;
  return {
    externalId,
    number: series ? `${series}/${number}` : number,
    series,
    documentType: typeof saft === 'string' && saft ? saft : fallback.documentType,
    total,
    issuedAt: date,
    warnings: [],
  };
}

async function readDocument(ctx: Ctx, externalId: string, fallback: { documentType: string; date: string }) {
  const doc = await ctx.client.call<any>('documents/getOne', { document_id: documentId(externalId) });
  return toIssued(doc, externalId, fallback);
}

/** Only https links on moloni.pt or one of its subdomains are downloaded. */
function isMoloniUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'moloni.pt' || host.endsWith('.moloni.pt'));
  } catch {
    return false;
  }
}

/** A line of the original document that can still be credited (`documents/getUnrelatedProducts`). */
type OpenLine = { lineId: number; productId: number; reference: string; qty: number };

/**
 * Moloni credits lines, not amounts: each credit-note line names the original document's line it
 * credits (`related_id` = that line's `document_product_id`). The open lines come from
 * `documents/getUnrelatedProducts`; each credit line takes the first one with the same product
 * (by id, else by reference) that still has the quantity, which is then used up. Checked before
 * any write: a line that cannot be matched refuses the credit note.
 */
async function relateToOriginal(
  ctx: Ctx,
  originalId: number,
  products: Record<string, unknown>[],
  lines: { name: string; sku: string; kind: string }[]
) {
  const answer = await ctx.client.call<any>('documents/getUnrelatedProducts', { document_id: originalId });
  const raw: any[] = Array.isArray(answer) ? answer : Array.isArray(answer?.products) ? answer.products : [];
  const open: OpenLine[] = raw
    .map((p) => ({
      lineId: Number(p?.document_product_id),
      productId: Number(p?.product_id),
      reference: typeof p?.reference === 'string' ? p.reference : '',
      qty: Number(p?.qty),
    }))
    .filter((p) => Number.isInteger(p.lineId) && p.lineId > 0 && p.qty > 0);
  const EPSILON = 1e-6;
  products.forEach((product, i) => {
    const qty = Number(product.qty);
    const fits = (l: OpenLine) => l.qty + EPSILON >= qty;
    const match =
      open.find((l) => l.productId === product.product_id && fits(l)) ??
      open.find((l) => !!l.reference && l.reference === lines[i]?.sku && fits(l));
    if (!match) {
      throw requestFailed(
        `Line ${i + 1} is not on the original Moloni document, or that quantity was already credited.`
      );
    }
    match.qty -= qty;
    product.related_id = match.lineId;
  });
}

type PdfAnswer = { status: number; bytes: Buffer };

async function downloadPdf(url: string): Promise<PdfAnswer> {
  const res = await timedFetch(url, { method: 'GET' }, (r) => readCapped(r, PDF_MAX_BYTES), PDF_TIMEOUT_MS);
  if (!res) throw new EcommerceBillingError('BILLING_UNREACHABLE', 'Could not download the Moloni PDF.');
  if (!res.bytes) throw requestFailed('The Moloni PDF is too large.');
  return { status: res.status, bytes: res.bytes };
}

const isPdf = (res: PdfAnswer) =>
  res.status >= 200 && res.status < 300 && res.bytes.subarray(0, 4).toString('latin1') === '%PDF';

/** The target of an HTML page's `<meta http-equiv="refresh" content="…; URL=…">`, on moloni.pt only. */
export function metaRefreshUrl(res: PdfAnswer, base: string): string | null {
  if (!res.bytes.length || res.bytes.length > PDF_MAX_BYTES) return null;
  const html = res.bytes.toString('utf8');
  const tag = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i.exec(html)?.[0];
  const content = tag && /content=(["'])(.*?)\1/i.exec(tag)?.[2];
  const target = content && /url\s*=\s*(.+)$/i.exec(content)?.[1]?.trim().replace(/&amp;/g, '&');
  if (!target) return null;
  try {
    const next = new URL(target, base).toString();
    return isMoloniUrl(next) ? next : null;
  } catch {
    return null;
  }
}

/** Reads the body up to `max` bytes; `bytes` is null when it is larger (the stream is cancelled). */
async function readCapped(res: Response, max: number): Promise<{ status: number; bytes: Buffer | null }> {
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status, bytes: null };
  }
  if (!res.body) return { status: res.status, bytes: Buffer.alloc(0) };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return { status: res.status, bytes: null };
    }
    chunks.push(value);
  }
  return { status: res.status, bytes: Buffer.concat(chunks) };
}

const today = () => new Date().toISOString().slice(0, 10);

export const moloniProvider: BillingProvider = {
  id: 'moloni',
  capabilities: { creditNotes: true, findByReference: true },
  // Token, customer, one lookup (and maybe an insert) per line, document, read-back, receipt:
  // at 20 s per call a long invoice can take minutes.
  maxIssueDurationMs: 10 * 60 * 1000,

  async issue(draft, rt) {
    const ctx = context(rt);
    const isCredit = draft.kind === 'CREDIT_NOTE';
    if (isCredit && !draft.original?.externalId) throw requestFailed('A credit note needs the original document.');
    const documentType = isCredit ? 'NC' : str(rt, 'documentType') === 'FT' ? 'FT' : 'FR';

    // Everything that can be refused locally is checked before the first write.
    // FR must be fully paid, and the FT receipt settles the whole document.
    if (!isCredit && (documentType === 'FR' || draft.payments.length)) {
      const paid = draft.payments.reduce((sum, p) => sum + p.amount, 0);
      if (paid !== draft.total) throw requestFailed('The payments do not add up to the document total.');
    }
    const exemptionReason = str(rt, 'exemptionReason');
    if (draft.lines.some((l) => l.tax === 0) && !exemptionReason) {
      throw new EcommerceBillingError('BILLING_EXEMPTION_REASON_MISSING', 'A 0% line needs an exemption reason.');
    }
    const lineTaxes: LineTax[] = [];
    for (const line of draft.lines) {
      lineTaxes.push(line.tax === 0 ? { exemption_reason: exemptionReason } : { taxes: [{ tax_id: await ctx.taxId(line.tax) }] });
    }
    const documentSetId = await ctx.idOf('documentSetId', 'documentSets/getAll', 'document_set_id');
    let paymentMethod: Promise<number> | null = null;
    const paymentMethodId = () => (paymentMethod ??= ctx.idOf('paymentMethodId', 'paymentMethods/getAll', 'payment_method_id'));
    const payments = isCredit
      ? []
      : await Promise.all(
          draft.payments.map(async (p) => ({
            payment_method_id:
              p.method === 'STORE_CREDIT'
                ? configuredId(rt, 'storeCreditPaymentMethodId') ?? (await paymentMethodId())
                : await paymentMethodId(),
            date: p.date,
            value: euros(p.amount),
          }))
        );

    const customer = await customerId(ctx, draft, paymentMethodId);
    const shippingReference = str(rt, 'shippingReference') || DEFAULT_SHIPPING_REFERENCE;
    const products: Record<string, unknown>[] = [];
    const known = new Map<string, number>();
    for (const [i, line] of draft.lines.entries()) {
      const reference = line.kind === 'SHIPPING' ? shippingReference : line.sku;
      let id = known.get(reference);
      if (id === undefined) {
        id = await productId(ctx, line, reference, lineTaxes[i]);
        known.set(reference, id);
      }
      products.push({ product_id: id, name: line.name, qty: line.quantity, price: netUnitPrice(line), ...lineTaxes[i] });
    }
    if (isCredit) await relateToOriginal(ctx, documentId(draft.original!.externalId), products, draft.lines);

    const document: Record<string, unknown> = {
      date: draft.date,
      expiration_date: draft.date,
      document_set_id: documentSetId,
      customer_id: customer,
      our_reference: draft.ourReference,
      notes: isCredit && draft.reason?.trim() ? `Order ${draft.orderReference} — ${draft.reason.trim()}` : `Order ${draft.orderReference}`,
      products,
      status: 1,
    };
    let path: string;
    if (isCredit) {
      path = 'creditNotes/insert';
      document.associated_documents = [{ associated_id: documentId(draft.original!.externalId), value: euros(draft.total) }];
    } else if (documentType === 'FR') {
      path = 'invoiceReceipts/insert';
      document.payments = payments;
    } else {
      path = 'invoices/insert';
    }
    const inserted = await ctx.client.call<any>(path, document, { write: true });
    const id = Number(inserted?.document_id);
    // Moloni accepted the document: from here on any failure leaves an issued document behind.
    if (!Number.isInteger(id) || id <= 0) {
      throw requestFailed(
        `Moloni accepted ${path} but its answer had no document id (it returned ${describeShape(inserted)}).`,
        true
      );
    }
    const externalId = String(id);

    const warnings: string[] = [];
    if (documentType === 'FT' && payments.length) {
      try {
        await ctx.client.call(
          'receipts/insert',
          {
            date: draft.date,
            document_set_id: documentSetId,
            customer_id: customer,
            net_value: euros(draft.total),
            associated_documents: [{ associated_id: id, value: euros(draft.total) }],
            payments,
            status: 1,
          },
          { write: true }
        );
      } catch {
        warnings.push('RECEIPT_FAILED');
      }
    }

    let issued: IssuedDocument;
    try {
      issued = await readDocument(ctx, externalId, { documentType, date: draft.date });
    } catch (e) {
      const code = e instanceof EcommerceBillingError ? e.code : 'BILLING_REQUEST_FAILED';
      throw new EcommerceBillingError(code, 'Moloni issued the document but it could not be read back.', true);
    }
    if (issued.total !== null && issued.total !== draft.total) warnings.push(`TOTAL_MISMATCH:${issued.total - draft.total}`);
    return { ...issued, warnings };
  },

  async getDocument(externalId, rt) {
    return readDocument(context(rt), externalId, { documentType: '', date: today() });
  },

  async getPdf(externalId, rt) {
    const ctx = context(rt);
    const link = await ctx.client.call<any>('documents/getPDFLink', { document_id: documentId(externalId) });
    let url = typeof link?.url === 'string' ? link.url : '';
    if (url.startsWith('//')) url = `https:${url}`;
    if (!isMoloniUrl(url)) {
      throw requestFailed(
        url
          ? 'Moloni returned a PDF link outside moloni.pt.'
          : `Moloni did not return a PDF link (it returned ${describeShape(link)}).`
      );
    }
    // The link opens Moloni's download page, which forwards to the file with a meta refresh
    // (a browser follows it on its own): follow it once, only to moloni.pt.
    let res = await downloadPdf(url);
    const forward = isPdf(res) ? null : metaRefreshUrl(res, url);
    if (forward) res = await downloadPdf(forward);
    if (!isPdf(res)) {
      const start = res.bytes.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
      const kind = !res.bytes.length ? 'an empty answer' : start.startsWith('<') ? 'an HTML page' : 'something other than a PDF';
      throw requestFailed(`Moloni did not return a PDF (HTTP ${res.status}, ${kind}).`);
    }
    return res.bytes;
  },

  async findByReference(ourReference, rt) {
    const ctx = context(rt);
    const found = await ctx.client.call<any>('documents/getAll', { our_reference: ourReference });
    const hit = Array.isArray(found)
      ? found.find((d) => Number(d?.document_id) > 0 && (d.our_reference === undefined || d.our_reference === ourReference))
      : null;
    return hit ? readDocument(ctx, String(hit.document_id), { documentType: '', date: today() }) : null;
  },
};

