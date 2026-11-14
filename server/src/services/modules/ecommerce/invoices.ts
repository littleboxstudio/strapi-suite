import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceBillingError, EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import type { OrderActionKey } from './domain/orders';
import {
  invoiceCustomer,
  paymentMethodName,
  readInvoiceLines,
  type InvoiceCustomer,
  type InvoiceLine,
} from './domain/invoicing';
import {
  fitsPosition,
  priceSelection,
  readInvoiceDoc,
  type CreditType,
  type PricedSelection,
  type SelectionRequest,
} from './domain/invoiceSelection';
import {
  getBillingProvider,
  type BillingProvider,
  type InvoiceDraft,
  type IssuedDocument,
} from './providers/billing';
import {
  buildCreditLines,
  creditOptions,
  exceedsCreditable,
  type CreditOptions,
} from './domain/creditNotes';
import type { ShippingLineOrigin } from './domain/shippingLines';
import type { ProviderRuntime } from './providers/registry';
import type { OrderHistoryEntry } from './orderHistory';
import type { OrderState } from './orders';

const MAX_KEY = 255;
const MAX_REASON = 500;
/**
 * A PENDING row older than the issuing provider's `maxIssueDurationMs` (this default when it
 * declares none) was left by an interrupted request: it may be reconciled.
 */
const DEFAULT_MAX_ISSUE_MS = 10 * 60 * 1000;

export type InvoiceKind = 'INVOICE' | 'CREDIT_NOTE';

export type InvoiceView = {
  id: number;
  kind: InvoiceKind;
  documentType: string | null;
  status: 'PENDING' | 'ISSUED' | 'FAILED' | 'UNCERTAIN';
  provider: string;
  number: string | null;
  series: string | null;
  total: number;
  lines: InvoiceLine[];
  creditedInvoiceId: number | null;
  /** Total of the ISSUED credit notes on this invoice. */
  credited: number;
  paymentIds: number[];
  error: string | null;
  /** The provider's message for a FAILED / UNCERTAIN row (rejected fields, rule), when it gave one. */
  errorDetail: string | null;
  warnings: string[];
  issuedAt: string | null;
  createdAt: string | null;
  /**
   * Reconcile / mark as failed is allowed: UNCERTAIN, or PENDING for longer than the issuing
   * provider's maximum issue duration.
   */
  reconcilable: boolean;
};

/** What a new invoice can still take (plan 11): empty lists when the order is not OPEN. */
export type InvoiceSelectionView = {
  /** Order lines with units left to invoice. */
  lines: {
    orderLineId: number;
    sku: string;
    name: string;
    option: string | null;
    tax: number;
    isGift: boolean;
    remainingQuantity: number;
    remainingValue: number;
  }[];
  /** Available shipping lines (positive, not invoiced). */
  shipping: {
    shippingLineId: number;
    name: string;
    tax: number;
    origin: ShippingLineOrigin;
    createdAt: string;
    value: number;
  }[];
  /** Available payments, in settlement order: `net` = amount − refunded. */
  payments: { paymentId: number; amount: number; refunded: number; net: number }[];
  /** Excess to refund before invoicing (ruling 10). */
  excess: number;
  /**
   * Value no remaining unit or available shipping line can carry (the order changed after it was
   * invoiced): never selectable, a Correction credit note and a new invoice take it up.
   */
  stranded: { products: number; shipping: number };
};

export type IssueInvoiceInput = SelectionRequest & { expectedTotal: number; idempotencyKey: string };

/** What a credit note on an ISSUED invoice can still credit, by reason (ruling 13). */
export type CreditNoteOptions = {
  lines: InvoiceLine[];
  /** Per line index: cents still creditable. */
  creditable: number[];
  /** The CORRECTION credit note: everything still creditable. */
  correction: { lines: InvoiceLine[]; total: number };
  /** Per ITEM line with whole units left: the units a RETURN may credit (`units`, maybe 0). */
  returnable: CreditOptions['returnable'];
  /** SHIPPING lines a RETURN may add whole. */
  shipping: CreditOptions['shipping'];
  /** Another credit note on this invoice is PENDING or UNCERTAIN: a CORRECTION waits for it. */
  correctionBlocked: boolean;
};

export type CreditNoteInput = {
  creditType: CreditType;
  /** RETURN only: units per ITEM line index of the invoice. */
  lines?: { index: number; quantity: number }[];
  /** RETURN only: SHIPPING line indexes of the invoice, credited whole. */
  shippingIndexes?: number[];
  reason: string;
  idempotencyKey: string;
};

type Collector = { emit(e: any): void; flush(): Promise<void> };

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v && typeof v === 'object' ? (v.id ?? null) : v == null ? null : Number(v);

const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid invoice request', [{ path, code }]);
const notAvailable = () => invalid('action', 'ACTION_NOT_AVAILABLE');
const notInvoiceable = () => invalid('paymentIds', 'PAYMENT_NOT_INVOICEABLE');

const warningsOf = (row: any): string[] => {
  const raw = row?.metadata?.warnings;
  return Array.isArray(raw) ? raw.filter((w: unknown): w is string => typeof w === 'string') : [];
};

/** Only an `EcommerceBillingError` without `uncertain` proves the provider issued nothing. */
const isUncertain = (err: unknown): boolean =>
  !(err instanceof EcommerceBillingError) || err.uncertain;

const billingCode = (err: unknown): string =>
  err instanceof EcommerceBillingError ? err.code : 'BILLING_REQUEST_FAILED';

/** Longest failure detail kept on the row (and shown to admins). */
const MAX_ERROR_DETAIL = 1000;

/**
 * What went wrong, for the log and the admin: the provider's own message (built by the provider
 * from the rejected fields and codes, never credentials), or the class and message of an
 * unexpected error. Null when it adds nothing to the code.
 */
export const billingErrorDetail = (err: unknown): string | null => {
  if (!(err instanceof Error)) return null;
  const message = (err.message ?? '').trim();
  const text = err instanceof EcommerceBillingError ? message : `${err.name}: ${message}`;
  if (!message || message === billingCode(err)) return null;
  return text.length > MAX_ERROR_DETAIL ? `${text.slice(0, MAX_ERROR_DETAIL - 1)}…` : text;
};

/** `metadata.errorDetail` of a FAILED or UNCERTAIN row. */
const errorDetailOf = (row: any): string | null => {
  const raw = row?.metadata?.errorDetail;
  return typeof raw === 'string' && raw ? raw : null;
};

/** The row's metadata without the failure detail (the document was issued after all). */
const withoutErrorDetail = (metadata: any) => {
  const { errorDetail: _drop, ...rest } = metadata ?? {};
  return rest;
};

/**
 * Invoicing (design 4.4; plan 11): one invoice for a selection of units, shipping lines and
 * payments whose net values pay it exactly; credit notes; reconciliation of uncertain outcomes;
 * PDFs fetched from the issuing provider.
 *
 * Provider calls never run inside a transaction: a PENDING row (and its allocations) is committed
 * first, the provider is called, then a second transaction records ISSUED, FAILED or UNCERTAIN.
 * An UNCERTAIN result is never re-issued automatically: `reconcile` looks it up by `ourReference`.
 */
const EcommerceInvoiceService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    lockOrder(orderId: number): Promise<void>;
    computeOrderState(orderId: number): Promise<OrderState>;
    assertAction(state: OrderState, action: OrderActionKey, allowed?: boolean): void;
  } => service('EcommerceOrderService');
  const settings = (): {
    getActiveProviders(category: 'billing'): Promise<string[]>;
    getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
    getStoreSettings(): Promise<{ timezone?: string }>;
  } => service('EcommerceSettingsService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');

  const runtimeOf = (rt: ProviderRuntime): ProviderRuntime => ({
    config: rt.config,
    secrets: rt.secrets,
  });

  // ---------------------------------------------------------------------------
  // Provider
  // ---------------------------------------------------------------------------

  const activeProvider = async (): Promise<{
    provider: BillingProvider;
    runtime: ProviderRuntime;
  }> => {
    const ids = await settings().getActiveProviders('billing');
    if (ids.length === 0) throw new EcommerceBillingError('BILLING_NOT_CONFIGURED');
    if (ids.length > 1) throw new EcommerceBillingError('BILLING_PROVIDER_AMBIGUOUS');
    const provider = getBillingProvider(ids[0]);
    const runtime = provider ? await settings().getRuntime(ids[0]) : null;
    if (!provider || !runtime) throw new EcommerceBillingError('BILLING_NOT_CONFIGURED');
    return { provider, runtime: runtimeOf(runtime) };
  };

  /**
   * The provider that issued `row`, with its stored credentials, even when it is no longer the
   * active one. A deliberate exception to "one active billing provider": PDFs and credit notes
   * belong to the provider that holds the original document (a credit note must reference it).
   */
  const issuingProvider = async (
    row: any
  ): Promise<{ provider: BillingProvider; runtime: ProviderRuntime } | null> => {
    const provider = row?.provider ? getBillingProvider(String(row.provider)) : undefined;
    if (!provider) return null;
    const runtime = await settings().getRuntime(provider.id);
    return runtime ? { provider, runtime: runtimeOf(runtime) } : null;
  };

  /** For the order view: no credentials are read (decrypted) to answer it. */
  const billingStatus = async (): Promise<{ active: boolean; providerId: string | null }> => {
    const ids = await settings().getActiveProviders('billing');
    if (ids.length !== 1 || !getBillingProvider(ids[0])) return { active: false, providerId: null };
    return { active: true, providerId: ids[0] };
  };

  /** The store time zone; logs and uses UTC when it is missing or invalid. */
  const storeTimeZone = async (): Promise<string> => {
    const store = await settings().getStoreSettings();
    const tz = clean(store?.timezone);
    try {
      if (!tz) throw new Error('missing');
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      strapi.log?.warn?.('[ecommerce] invalid store time zone: invoice dates use UTC');
      return 'UTC';
    }
  };

  const dateIn = (value: unknown, tz: string): string => {
    const d = value ? new Date(value as string) : new Date();
    const date = Number.isFinite(d.getTime()) ? d : new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  const findRow = (where: Record<string, unknown>) =>
    strapi.db.query(uids().invoice).findOne({
      where,
      populate: { order: { select: ['id'] }, creditedInvoice: { select: ['id'] } },
    });

  const loadRow = async (invoiceId: number) => {
    const row = await findRow({ id: Number(invoiceId) });
    if (!row) throw new EcommerceNotFoundError('Invoice not found');
    return row;
  };

  const toViews = async (rows: any[]): Promise<InvoiceView[]> => {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [allocationRows, creditRows] = await Promise.all([
      strapi.db.query(uids().invoiceAllocation).findMany({
        where: { invoice: { id: { $in: ids } } },
        populate: { invoice: { select: ['id'] }, payment: { select: ['id'] } },
        orderBy: { id: 'asc' },
      }) as Promise<any[]>,
      strapi.db.query(uids().invoice).findMany({
        where: { creditedInvoice: { id: { $in: ids } }, kind: 'CREDIT_NOTE', status: 'ISSUED' },
        populate: { creditedInvoice: { select: ['id'] } },
      }) as Promise<any[]>,
    ]);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
      documentType: r.documentType ?? null,
      status: r.status,
      provider: r.provider ?? '',
      number: r.number ?? null,
      series: r.series ?? null,
      total: num(r.total),
      lines: readInvoiceLines(r.lines),
      creditedInvoiceId: idOf(r.creditedInvoice),
      credited: creditRows
        .filter((cn) => idOf(cn.creditedInvoice) === r.id)
        .reduce((s, cn) => s + num(cn.total), 0),
      paymentIds: allocationRows
        .filter((a) => idOf(a.invoice) === r.id)
        .map((a) => idOf(a.payment))
        .filter((id): id is number => id !== null),
      error: r.error ?? null,
      errorDetail: r.status === 'ISSUED' ? null : errorDetailOf(r),
      warnings: warningsOf(r),
      issuedAt: r.issuedAt ?? null,
      createdAt: r.createdAt ?? null,
      reconcilable: reconcilable(r),
    }));
  };

  const viewOf = async (invoiceId: number): Promise<InvoiceView> =>
    (await toViews([await loadRow(invoiceId)]))[0];

  const listForOrder = async (orderId: number): Promise<InvoiceView[]> =>
    toViews(
      await strapi.db.query(uids().invoice).findMany({
        where: { order: { id: Number(orderId) } },
        populate: { creditedInvoice: { select: ['id'] } },
        orderBy: { id: 'asc' },
      })
    );

  /** The document created with `key`, refusing a key used on another order or kind. */
  const findByKey = async (orderId: number, key: string, kind: InvoiceKind) => {
    const row = await findRow({ idempotencyKey: key });
    if (row && (idOf(row.order) !== orderId || row.kind !== kind)) {
      throw invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT');
    }
    return row;
  };

  const keyOf = (input: { idempotencyKey?: unknown } | undefined): string => {
    const key = clean(input?.idempotencyKey);
    if (!key) throw invalid('idempotencyKey', 'required');
    if (key.length > MAX_KEY) throw invalid('idempotencyKey', 'too_long');
    return key;
  };

  // ---------------------------------------------------------------------------
  // Selection and customer
  // ---------------------------------------------------------------------------

  const customerOf = (order: any): InvoiceCustomer => {
    const c = (order.customerSnapshot ?? {}) as Record<string, unknown>;
    return invoiceCustomer(order.billingAddress ?? null, {
      firstName: clean(c.firstName),
      lastName: clean(c.lastName),
      email: clean(c.email),
    });
  };

  /** The payments as `priceSelection` reads them: net values and availability. */
  const selectablePayments = (state: OrderState) => {
    const { invoicing } = state;
    const available = new Set(invoicing.availablePaymentIds);
    return invoicing.completedPayments.map((p) => ({
      id: p.id as number,
      net: invoicing.paymentNets.get(p.id) ?? 0,
      available: available.has(p.id),
    }));
  };

  const selection = async (rawOrderId: number | string): Promise<InvoiceSelectionView> => {
    const state = await orders().computeOrderState(Number(rawOrderId));
    const { invoicing } = state;
    const excess = invoicing.blockingExcess;
    if (state.order.orderStatus !== 'OPEN') {
      return { lines: [], shipping: [], payments: [], excess, stranded: { products: 0, shipping: 0 } };
    }
    const orderLines = new Map(state.lines.map((l) => [l.id, l]));
    const shippingLines = new Map(invoicing.positionOrder.shippingLines.map((l) => [l.id, l]));
    const available = new Set(invoicing.availablePaymentIds);
    return {
      lines: invoicing.position.lines
        .filter((l) => l.remainingQuantity > 0 && orderLines.has(l.orderLineId))
        .map((l) => {
          const line = orderLines.get(l.orderLineId)!;
          return {
            orderLineId: l.orderLineId,
            sku: line.sku,
            name: line.name,
            option: line.option,
            tax: line.tax,
            isGift: line.isGift,
            remainingQuantity: l.remainingQuantity,
            remainingValue: l.remainingValue,
          };
        }),
      shipping: invoicing.position.shipping
        .filter((s) => s.available && shippingLines.has(s.shippingLineId))
        .map((s) => {
          const line = shippingLines.get(s.shippingLineId)!;
          return {
            shippingLineId: s.shippingLineId,
            name: line.name,
            tax: line.tax,
            origin: line.origin,
            createdAt: line.createdAt,
            value: s.remainingValue,
          };
        }),
      payments: invoicing.completedPayments
        .filter((p) => available.has(p.id))
        .map((p) => {
          const amount = num(p.amount);
          const net = invoicing.paymentNets.get(p.id) ?? 0;
          return { paymentId: p.id as number, amount, refunded: amount - net, net };
        }),
      excess,
      stranded: { ...invoicing.position.stranded },
    };
  };

  /** The history's record of a selection: ids, quantities and values, never names. */
  const selectionRecord = (priced: PricedSelection) => ({
    lines: priced.lines.map((l) => ({
      orderLineId: l.orderLineId,
      quantity: l.quantity,
      value: l.value,
    })),
    shippingLineIds: priced.shipping.map((s) => s.shippingLineId),
    paymentIds: priced.payments.map((p) => p.paymentId),
  });

  // ---------------------------------------------------------------------------
  // Recording outcomes (inside the caller's transaction)
  // ---------------------------------------------------------------------------

  const releaseAllocations = (invoiceId: number) =>
    strapi.db.query(uids().invoiceAllocation).updateMany({
      where: { invoice: { id: invoiceId } },
      data: { uniqueKey: null },
    });

  const describe = (row: any) => (row.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice');

  const recordIssued = async (
    row: any,
    orderId: number,
    doc: IssuedDocument,
    ctx: {
      actor: string;
      collector: Collector;
      /** Late success on a FAILED row: extra warnings, and whether the customer event goes out. */
      late?: { warnings: string[]; emit: boolean };
    }
  ) => {
    const warnings = [
      ...(Array.isArray(doc.warnings) ? doc.warnings.filter((w) => typeof w === 'string') : []),
      ...(ctx.late?.warnings ?? []),
    ];
    await strapi.db.query(uids().invoice).update({
      where: { id: row.id },
      data: {
        status: 'ISSUED',
        error: null,
        externalId: String(doc.externalId),
        number: doc.number,
        series: doc.series ?? null,
        documentType: doc.documentType,
        issuedAt: doc.issuedAt || new Date().toISOString(),
        metadata: { ...withoutErrorDetail(row.metadata), warnings },
      },
    });
    const creditNote = row.kind === 'CREDIT_NOTE';
    const creditType = creditNote ? (row.metadata?.creditType ?? null) : null;
    // An issued CORRECTION annuls the invoice: its payments can be invoiced again (ruling 13).
    const annulled = creditType === 'CORRECTION' ? idOf(row.creditedInvoice) : null;
    if (annulled !== null) await releaseAllocations(annulled);
    await history().record({
      orderId,
      type: creditNote ? 'CREDIT_NOTE_ISSUED' : 'INVOICE_ISSUED',
      description: ctx.late
        ? `${describe(row)} ${doc.number} issued after it was marked failed (${row.error ?? 'FAILED'})` +
          (warnings.includes('DUPLICATE_INVOICE')
            ? ': what it invoices was invoiced again meanwhile, issue a credit note'
            : warnings.includes('DUPLICATE_CREDIT_NOTE')
              ? ': what it credits was credited again meanwhile, issue a corrective invoice'
              : '')
        : `${describe(row)} ${doc.number} issued (${num(row.total)} cents)`,
      previousValue: ctx.late ? { status: row.status, error: row.error ?? null } : null,
      newValue: {
        invoiceId: row.id,
        kind: row.kind,
        number: doc.number,
        total: num(row.total),
        provider: row.provider,
        ...(creditNote ? { creditedInvoiceId: idOf(row.creditedInvoice), creditType } : {}),
        ...(row.metadata?.selection ? { selection: row.metadata.selection } : {}),
        warnings,
      },
      actor: ctx.actor,
    });
    if (ctx.late && !ctx.late.emit) return;
    ctx.collector.emit({
      type: 'INVOICE_ISSUED',
      orderId,
      payload: { invoiceId: row.id, kind: creditNote ? 'CREDIT_NOTE' : 'INVOICE' },
    });
  };

  /** Removes a PENDING row the provider refused outright, with its allocations; logged in the history. */
  const discardRejected = async (
    row: any,
    orderId: number,
    error: string,
    detail: string | null,
    actor: string
  ) => {
    const u = uids();
    await strapi.db.query(u.invoiceAllocation).deleteMany({ where: { invoice: { id: row.id } } });
    await strapi.db.query(u.invoice).delete({ where: { id: row.id } });
    await history().record({
      orderId,
      type: 'INVOICE_FAILED',
      description: `${describe(row)} not issued: the provider refused it (${error}${detail ? `: ${detail}` : ''})`,
      previousValue: null,
      newValue: { kind: row.kind, error, ...(detail ? { detail } : {}) },
      actor,
    });
  };

  const recordFailed = async (
    row: any,
    orderId: number,
    error: string,
    actor: string,
    note = '',
    detail: string | null = null
  ) => {
    await strapi.db.query(uids().invoice).update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        error,
        ...(detail ? { metadata: { ...(row.metadata ?? {}), errorDetail: detail } } : {}),
      },
    });
    await releaseAllocations(row.id);
    await history().record({
      orderId,
      type: 'INVOICE_FAILED',
      description: `${describe(row)} #${row.id} failed (${error})${note}`,
      previousValue: { status: row.status },
      newValue: { invoiceId: row.id, kind: row.kind, error },
      actor,
    });
  };

  /**
   * Whether a late credit note credits what is no longer there: its invoice was annulled
   * meanwhile, or another credit note took the value, units or returned units it credits. The row
   * is FAILED, so `docs` count it out.
   */
  const lateCreditNoteDuplicates = async (row: any, invoicing: OrderState['invoicing']) => {
    const originalId = idOf(row.creditedInvoice);
    const original = originalId === null ? null : await findRow({ id: originalId });
    if (!original || invoicing.position.annulledInvoiceIds.includes(original.id)) return true;
    const invoice = readInvoiceDoc(original, []);
    const options = creditOptions(invoice, invoicing.docs, invoicing.positionOrder);
    return exceedsCreditable(readInvoiceDoc(row, []), invoice, options);
  };

  /**
   * The provider issued a document for a row an admin had already made FAILED (markFailed, or a
   * reconcile that found nothing yet). The document exists, so it is recorded ISSUED. Each
   * allocation is re-claimed only when its payment has no other active allocation (checked by a
   * query under the order lock). A payment invoiced again or refunded meanwhile (its net is below
   * the allocation), or units or shipping lines the position no longer has left (`fitsPosition`),
   * flag it DUPLICATE_INVOICE; a credit note whose value was credited again (or whose invoice was
   * annulled) meanwhile is flagged DUPLICATE_CREDIT_NOTE. A flagged document emits no customer
   * event.
   */
  const recordLateSuccess = async (
    row: any,
    orderId: number,
    doc: IssuedDocument,
    ctx: { actor: string; collector: Collector }
  ) => {
    // The row is FAILED, so the position is computed without it (ruling 14).
    const { invoicing } = await orders().computeOrderState(orderId);
    const creditNote = row.kind === 'CREDIT_NOTE';
    let duplicate = creditNote
      ? await lateCreditNoteDuplicates(row, invoicing)
      : !fitsPosition(invoicing.position, readInvoiceDoc(row, []), invoicing.positionOrder);
    const q = strapi.db.query(uids().invoiceAllocation);
    const rows: any[] = await q.findMany({
      where: { invoice: { id: row.id } },
      populate: { payment: { select: ['id'] } },
      orderBy: { id: 'asc' },
    });
    for (const a of rows) {
      const paymentId = idOf(a.payment);
      if (paymentId === null) continue;
      // Refunded meanwhile: the payment no longer holds what this invoice says it paid.
      if (num(a.amount) > (invoicing.paymentNets.get(paymentId) ?? 0)) duplicate = true;
      const active = await q.count({
        where: { payment: { id: paymentId }, uniqueKey: { $null: false } },
      });
      if (active > 0) {
        duplicate = true;
        continue;
      }
      await q.update({ where: { id: a.id }, data: { uniqueKey: `payment:${paymentId}` } });
    }
    const flag = creditNote ? 'DUPLICATE_CREDIT_NOTE' : 'DUPLICATE_INVOICE';
    const warnings = ['ISSUED_AFTER_FAILED', ...(duplicate ? [flag] : [])];
    strapi.log?.warn?.(
      `[ecommerce] ${describe(row).toLowerCase()} ${row.id} issued after it was marked failed: ${warnings.join(', ')}`
    );
    await recordIssued(row, orderId, doc, { ...ctx, late: { warnings, emit: !duplicate } });
  };

  /**
   * Transaction 2: records the provider's outcome on a PENDING row. A definitive error marks it
   * FAILED (allocations released) and is rethrown; an uncertain one leaves it UNCERTAIN.
   */
  const complete = async (
    rowId: number,
    orderId: number,
    call: { doc: IssuedDocument } | { error: unknown },
    actor: string
  ): Promise<InvoiceView> => {
    const collector = events().collector();
    let failure: unknown = null;
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(rowId);
      if (row.status === 'FAILED' && 'doc' in call) {
        await recordLateSuccess(row, orderId, call.doc, { actor, collector });
        return;
      }
      // Concluded meanwhile (an admin reconciled a stale PENDING row): keep that outcome.
      if (row.status !== 'PENDING') return;
      if ('doc' in call) {
        await recordIssued(row, orderId, call.doc, { actor, collector });
        return;
      }
      const code = billingCode(call.error);
      const detail = billingErrorDetail(call.error);
      strapi.log?.warn?.(
        `[ecommerce] ${describe(row).toLowerCase()} ${row.id} failed: ${code}${detail ? ` (${detail})` : ''}`
      );
      if (isUncertain(call.error)) {
        await strapi.db.query(uids().invoice).update({
          where: { id: row.id },
          data: {
            status: 'UNCERTAIN',
            error: code,
            ...(detail ? { metadata: { ...(row.metadata ?? {}), errorDetail: detail } } : {}),
          },
        });
        await history().record({
          orderId,
          type: 'INVOICE_UNCERTAIN',
          description: `${describe(row)} #${row.id}: outcome unknown (${code}); reconcile before retrying`,
          previousValue: null,
          newValue: { invoiceId: row.id, kind: row.kind, error: code },
          actor,
        });
        return;
      }
      // The provider refused it, so nothing was issued: the attempt is not kept as a document (the
      // admin sees the provider's message at once); only the order history remembers it.
      await discardRejected(row, orderId, code, detail, actor);
      failure = call.error;
    });
    await collector.flush();
    if (failure) throw failure;
    return viewOf(rowId);
  };

  const callIssue = async (
    provider: BillingProvider,
    draft: InvoiceDraft,
    runtime: ProviderRuntime
  ): Promise<{ doc: IssuedDocument } | { error: unknown }> => {
    try {
      const doc = await provider.issue(draft, runtime);
      if (!doc || !clean(doc.externalId) || !clean(doc.number)) {
        // A "success" without the document's id cannot be fetched or credited: unknown outcome.
        return {
          error: new EcommerceBillingError(
            'BILLING_REQUEST_FAILED',
            'BILLING_REQUEST_FAILED',
            true
          ),
        };
      }
      return { doc };
    } catch (error) {
      return { error };
    }
  };

  /**
   * Transaction 1 runs `prepare` under the order lock and returns the PENDING row and draft; a
   * refusal thrown by `prepare` rolls everything back. Same-key replays and unique-index races are
   * resolved here.
   */
  const twoPhase = async (
    orderId: number,
    key: string,
    kind: InvoiceKind,
    provider: BillingProvider,
    runtime: ProviderRuntime,
    prepare: () => Promise<{ row: any; draft: InvoiceDraft }>,
    actor: string,
    onConflict: () => Error
  ): Promise<InvoiceView> => {
    let prepared: { row: any; draft: InvoiceDraft } | { replay: any };
    try {
      prepared = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        // A request with the same key that held the lock first already answered.
        const winner = await findByKey(orderId, key, kind);
        if (winner) return { replay: winner };
        return prepare();
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, key, kind);
        if (winner) return viewOf(winner.id);
        // The allocation index: another invoice claimed one of the payments first.
        throw onConflict();
      }
      throw err;
    }
    if ('replay' in prepared) return viewOf(prepared.replay.id);
    const call = await callIssue(provider, prepared.draft, runtime);
    return complete(prepared.row.id, orderId, call, actor);
  };

  /** Creates the PENDING document row with `ourReference = LB-INV-<id>`. */
  const createPending = async (data: Record<string, unknown>) => {
    const u = uids();
    const created = await strapi.db
      .query(u.invoice)
      .create({ data: { ...data, status: 'PENDING' } });
    return strapi.db.query(u.invoice).update({
      where: { id: created.id },
      data: { ourReference: `LB-INV-${created.id}` },
    });
  };

  // ---------------------------------------------------------------------------
  // Issue
  // ---------------------------------------------------------------------------

  /**
   * Issues one invoice for the selected units, shipping lines and payments (ruling 11): the order
   * is OPEN, no excess is left to refund, the selection is priced against the position and equals
   * the payments' net values, and `expectedTotal` is the total the admin saw. Every check runs
   * before anything is written.
   */
  const issue = async (
    rawOrderId: number | string,
    input: IssueInvoiceInput,
    actor: string
  ): Promise<InvoiceView> => {
    const orderId = Number(rawOrderId);
    const key = keyOf(input);
    const u = uids();

    const existing = await findByKey(orderId, key, 'INVOICE');
    if (existing) return viewOf(existing.id);

    const { provider, runtime } = await activeProvider();
    const tz = await storeTimeZone();

    return twoPhase(
      orderId,
      key,
      'INVOICE',
      provider,
      runtime,
      async () => {
        const state = await orders().computeOrderState(orderId);
        const order = state.order;
        if (order.orderStatus !== 'OPEN') throw notAvailable();
        const { invoicing } = state;
        if (invoicing.blockingExcess > 0) throw invalid('excess', 'INVOICE_EXCESS_UNRESOLVED');
        const { selection: priced, issues } = priceSelection(
          invoicing.position,
          selectablePayments(state),
          { lines: input?.lines, shippingLineIds: input?.shippingLineIds, paymentIds: input?.paymentIds }
        );
        if (!priced) throw new EcommerceValidationError('Invalid invoice', issues);
        if (input?.expectedTotal !== priced.total) {
          throw new EcommerceValidationError('Invalid invoice', [
            { path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: String(priced.total) },
          ]);
        }

        const orderLines = new Map(state.lines.map((l) => [l.id, l]));
        const shippingLines = new Map(invoicing.positionOrder.shippingLines.map((l) => [l.id, l]));
        const lines: InvoiceLine[] = [
          ...priced.lines.map((l) => {
            const line = orderLines.get(l.orderLineId)!;
            return {
              orderLineId: l.orderLineId,
              kind: 'ITEM' as const,
              sku: line.sku,
              name: line.option ? `${line.name} - ${line.option}` : line.name,
              quantity: l.quantity,
              total: l.value,
              grossTotal: line.unitPrice * l.quantity,
              tax: line.tax,
              partial: false,
            };
          }),
          ...priced.shipping.map((s) => {
            const line = shippingLines.get(s.shippingLineId)!;
            return {
              orderLineId: null,
              kind: 'SHIPPING' as const,
              sku: 'SHIPPING',
              name: clean(line.name) || 'Shipping',
              quantity: 1,
              total: s.value,
              grossTotal: line.amount,
              tax: line.tax,
              partial: false,
              shippingLineId: s.shippingLineId,
            };
          }),
        ];
        const customer = customerOf(order);
        const row = await createPending({
          order: orderId,
          provider: provider.id,
          kind: 'INVOICE',
          customerData: customer,
          idempotencyKey: key,
          actor,
          total: priced.total,
          lines: { lines },
          metadata: { locale: order.locale, selection: selectionRecord(priced) },
        });
        for (const p of priced.payments) {
          await strapi.db.query(u.invoiceAllocation).create({
            data: {
              invoice: row.id,
              payment: p.paymentId,
              order: orderId,
              amount: p.value,
              coverage: { paymentId: p.paymentId, value: p.value },
              uniqueKey: `payment:${p.paymentId}`,
            },
          });
        }
        const paymentRows = new Map(invoicing.completedPayments.map((p) => [p.id, p]));
        const draft: InvoiceDraft = {
          kind: 'INVOICE',
          ourReference: row.ourReference,
          orderReference: `#${order.reference}`,
          date: dateIn(new Date(), tz),
          locale: order.locale,
          customer,
          lines,
          total: priced.total,
          // Σ amounts = total (checked by priceSelection).
          payments: priced.payments.map(({ paymentId, value }) => {
            const p = paymentRows.get(paymentId);
            return {
              method: p.method,
              name: paymentMethodName(p.method, p.metadata?.methodLabel),
              amount: value,
              date: dateIn(p.completedAt, tz),
            };
          }),
        };
        return { row, draft };
      },
      actor,
      notInvoiceable
    );
  };

  // ---------------------------------------------------------------------------
  // Reconcile
  // ---------------------------------------------------------------------------

  const reconcilable = (row: any): boolean => {
    if (row.status === 'UNCERTAIN') return true;
    if (row.status !== 'PENDING') return false;
    const created = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
    const declared = row.provider
      ? getBillingProvider(String(row.provider))?.maxIssueDurationMs
      : undefined;
    const maxMs = typeof declared === 'number' && declared > 0 ? declared : DEFAULT_MAX_ISSUE_MS;
    return !Number.isFinite(created) || Date.now() - created > maxMs;
  };

  const reconcile = async (
    invoiceId: number | string,
    input: { markFailed?: boolean },
    actor: string
  ): Promise<InvoiceView> => {
    const first = await loadRow(Number(invoiceId));
    if (!reconcilable(first)) throw notAvailable();
    const orderId = idOf(first.order) as number;

    if (input?.markFailed === true) {
      // The admin confirmed the document does not exist at the provider.
      await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        const row = await loadRow(first.id);
        if (!reconcilable(row)) throw notAvailable();
        await recordFailed(
          row,
          orderId,
          'MARKED_FAILED',
          actor,
          ' — marked as failed by the admin'
        );
      });
      return viewOf(first.id);
    }

    const issuing = await issuingProvider(first);
    if (!issuing) throw new EcommerceBillingError('BILLING_NOT_CONFIGURED');
    if (!issuing.provider.capabilities.findByReference) {
      throw new EcommerceBillingError('NOT_SUPPORTED');
    }
    // Errors leave the state as it is.
    const found = await issuing.provider.findByReference(first.ourReference, issuing.runtime);

    const collector = events().collector();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(first.id);
      if (!reconcilable(row)) return;
      if (found) {
        await recordIssued(row, orderId, found, { actor, collector });
      } else {
        await recordFailed(row, orderId, 'NOT_FOUND_AT_PROVIDER', actor);
      }
    });
    await collector.flush();
    return viewOf(first.id);
  };

  // ---------------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------------

  const getPdf = async (
    invoiceId: number | string
  ): Promise<{ filename: string; content: Buffer }> => {
    const row = await loadRow(Number(invoiceId));
    if (row.status !== 'ISSUED' || !row.externalId) throw notAvailable();
    const issuing = await issuingProvider(row);
    if (!issuing) throw new EcommerceBillingError('INVOICE_PDF_UNAVAILABLE');
    let content: Buffer;
    try {
      content = await issuing.provider.getPdf(String(row.externalId), issuing.runtime);
    } catch (err) {
      const detail = billingErrorDetail(err);
      strapi.log?.warn?.(
        `[ecommerce] PDF of ${describe(row).toLowerCase()} ${row.id} unavailable: ${billingCode(err)}${detail ? ` (${detail})` : ''}`
      );
      throw new EcommerceBillingError('INVOICE_PDF_UNAVAILABLE', detail ?? 'INVOICE_PDF_UNAVAILABLE');
    }
    if (!content || !content.length) throw new EcommerceBillingError('INVOICE_PDF_UNAVAILABLE');
    const base = clean(row.number) || `invoice-${row.id}`;
    return { filename: `${base.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, content };
  };

  // ---------------------------------------------------------------------------
  // Credit notes
  // ---------------------------------------------------------------------------

  const loadIssuedInvoice = async (invoiceId: number) => {
    const row = await loadRow(invoiceId);
    if (row.kind !== 'INVOICE' || row.status !== 'ISSUED') throw notAvailable();
    return row;
  };

  /**
   * What `original` (an ISSUED invoice) can still credit, against the order's live documents.
   * Credit notes ISSUED, PENDING or UNCERTAIN count, so nothing is credited twice.
   */
  const creditOptionsOf = (original: any, state: OrderState) => {
    const invoice = readInvoiceDoc(original, []);
    const { docs, positionOrder } = state.invoicing;
    return { invoice, options: creditOptions(invoice, docs, positionOrder) };
  };

  /** A credit note on `invoiceId` is PENDING or UNCERTAIN: a CORRECTION must wait for it. */
  const creditNoteInProgress = (invoiceId: number, state: OrderState): boolean =>
    state.invoicing.docs.some(
      (d) =>
        d.kind === 'CREDIT_NOTE' &&
        d.creditedInvoiceId === invoiceId &&
        (d.status === 'PENDING' || d.status === 'UNCERTAIN')
    );

  const creditNotePreview = async (invoiceId: number | string): Promise<CreditNoteOptions> => {
    const row = await loadIssuedInvoice(Number(invoiceId));
    const state = await orders().computeOrderState(idOf(row.order) as number);
    const { invoice, options } = creditOptionsOf(row, state);
    const correction = buildCreditLines(invoice, options, {
      creditType: 'CORRECTION',
      lines: [],
      shippingIndexes: [],
    });
    return {
      lines: invoice.lines,
      creditable: options.creditable,
      correction: { lines: correction.lines, total: correction.total },
      returnable: options.returnable,
      shipping: options.shipping,
      correctionBlocked: creditNoteInProgress(row.id, state),
    };
  };

  /**
   * Issues a credit note on an ISSUED invoice, on an order in any status (ruling 13): a RETURN
   * credits returned units (and whole shipping lines); a CORRECTION credits everything left and,
   * once ISSUED, annuls the invoice (`recordIssued` releases its payments). Never automatic.
   */
  const issueCreditNote = async (
    rawInvoiceId: number | string,
    input: CreditNoteInput,
    actor: string
  ): Promise<InvoiceView> => {
    const key = keyOf(input);
    const reason = clean(input?.reason);
    if (!reason) throw invalid('reason', 'required');
    if (reason.length > MAX_REASON) throw invalid('reason', 'too_long');
    const first = await loadRow(Number(rawInvoiceId));
    const orderId = idOf(first.order) as number;

    const existing = await findByKey(orderId, key, 'CREDIT_NOTE');
    if (existing) return viewOf(existing.id);

    if (first.kind !== 'INVOICE' || first.status !== 'ISSUED') throw notAvailable();
    const issuing = await issuingProvider(first);
    if (!issuing) throw new EcommerceBillingError('BILLING_NOT_CONFIGURED');
    if (!issuing.provider.capabilities.creditNotes)
      throw new EcommerceBillingError('NOT_SUPPORTED');
    const tz = await storeTimeZone();

    return twoPhase(
      orderId,
      key,
      'CREDIT_NOTE',
      issuing.provider,
      issuing.runtime,
      async () => {
        // Any OrderStatus: a credit note regularizes what was invoiced.
        const original = await loadIssuedInvoice(first.id);
        const state = await orders().computeOrderState(orderId);
        const { invoice, options } = creditOptionsOf(original, state);
        const creditType = input?.creditType;
        // A CORRECTION credits everything left: it waits until no other credit note is unknown.
        if (creditType === 'CORRECTION' && creditNoteInProgress(original.id, state)) {
          throw invalid('creditType', 'CREDIT_NOTE_IN_PROGRESS');
        }
        const built = buildCreditLines(invoice, options, {
          creditType,
          lines: Array.isArray(input?.lines) ? input.lines : [],
          shippingIndexes: Array.isArray(input?.shippingIndexes) ? input.shippingIndexes : [],
        });
        if (built.issues.length) throw new EcommerceValidationError('Invalid credit note', built.issues);

        const { lines, total, creditedLines } = built;
        const locale = clean(original.metadata?.locale) || state.order.locale;
        const customer = (original.customerData ?? customerOf(state.order)) as InvoiceCustomer;

        const row = await createPending({
          order: orderId,
          provider: issuing.provider.id,
          kind: 'CREDIT_NOTE',
          creditedInvoice: original.id,
          total,
          lines: { lines },
          customerData: customer,
          idempotencyKey: key,
          actor,
          metadata: { locale, reason, creditType, creditedLines },
        });
        const draft: InvoiceDraft = {
          kind: 'CREDIT_NOTE',
          ourReference: row.ourReference,
          orderReference: `#${state.order.reference}`,
          date: dateIn(new Date(), tz),
          locale,
          customer,
          lines,
          total,
          payments: [],
          original: { externalId: String(original.externalId), total: num(original.total) },
          reason,
        };
        return { row, draft };
      },
      actor,
      () => invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT')
    );
  };

  return {
    activeProvider,
    billingStatus,
    selection,
    issue,
    reconcile,
    getPdf,
    creditNotePreview,
    issueCreditNote,
    listForOrder,
  };
};

export default EcommerceInvoiceService;
