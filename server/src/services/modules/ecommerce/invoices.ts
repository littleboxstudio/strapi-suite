import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  EcommerceBillingError,
  EcommerceNotFoundError,
  EcommerceValidationError,
  type ValidationIssue,
} from './errors';
import { isUniqueViolation } from './dbErrors';
import { allocateProportionally, type OrderActionKey, type OrderStatus } from './domain/orders';
import {
  buildInvoiceLines,
  creditNoteBudget,
  invoiceCustomer,
  overInvoiced,
  suggestCreditNote,
  validateCreditNoteRequest,
  type InvoiceCustomer,
  type InvoiceLine,
  type OverInvoiced,
  type ReconciledCoverage,
} from './domain/invoicing';
import {
  getBillingProvider,
  type BillingProvider,
  type InvoiceDraft,
  type IssuedDocument,
} from './providers/billing';
import { readShippingLines, shippingTaxRates } from './domain/shippingLines';
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
const LIVE = ['ISSUED', 'PENDING', 'UNCERTAIN'];

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

export type InvoiceScope = { type: 'PAYMENT'; paymentId: number } | { type: 'TOTAL' };

export type CreditNoteInput = {
  lines: { index: number; value: number }[];
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
const notInvoiceable = () => invalid('paymentId', 'PAYMENT_NOT_INVOICEABLE');

/** The stored `lines` JSON (`{ lines: [...] }`), malformed entries dropped. */
const linesOf = (row: any): InvoiceLine[] => {
  const raw = row?.lines?.lines;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l: any) => l && typeof l === 'object')
    .map((l: any) => ({
      orderLineId: l.orderLineId == null ? null : Number(l.orderLineId),
      kind: l.kind === 'SHIPPING' ? 'SHIPPING' : 'ITEM',
      sku: typeof l.sku === 'string' ? l.sku : '',
      name: typeof l.name === 'string' ? l.name : '',
      quantity: num(l.quantity),
      total: num(l.total),
      tax: num(l.tax),
      partial: l.partial === true,
    }));
};

/** `metadata.creditedLines` of a credit note: what it credited per original line index. */
const creditedLinesOf = (row: any): { index: number; value: number }[] => {
  const raw = row?.metadata?.creditedLines;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e: any) => e && Number.isInteger(e.index) && Number.isFinite(Number(e.value)))
    .map((e: any) => ({ index: e.index as number, value: num(e.value) }));
};

const returnIdsOf = (row: any): number[] => {
  const raw = row?.metadata?.returnIds;
  return Array.isArray(raw) ? raw.map(Number).filter(Number.isInteger) : [];
};

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

const lineKey = (l: InvoiceLine): number | 'SHIPPING' =>
  l.kind === 'SHIPPING' || l.orderLineId === null ? 'SHIPPING' : l.orderLineId;

/**
 * A credit-note line: the original line with `total = value`, keeping the quantity ratio when it
 * comes out whole (otherwise quantity 1, partial).
 */
const creditLine = (line: InvoiceLine, value: number): InvoiceLine => {
  const scaled = line.quantity * value;
  const whole = line.total > 0 && scaled % line.total === 0 && scaled / line.total >= 1;
  return {
    ...line,
    quantity: whole ? scaled / line.total : 1,
    total: value,
    partial: whole ? line.partial : true,
  };
};

/**
 * Invoicing (design 4.4): one invoice per settled payment or for every uninvoiced payment, each
 * covering what its payments paid reconciled with the current lines; credit notes; reconciliation
 * of uncertain outcomes; PDFs fetched from the issuing provider.
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
      lines: linesOf(r),
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
  // Invoice composition
  // ---------------------------------------------------------------------------

  const normalizeScope = (scope: InvoiceScope): InvoiceScope => {
    const raw = (scope && typeof scope === 'object' ? scope : {}) as Record<string, unknown>;
    if (raw.type === 'TOTAL') return { type: 'TOTAL' };
    if (raw.type === 'PAYMENT') {
      const paymentId = Number(raw.paymentId);
      if (!Number.isSafeInteger(paymentId) || paymentId < 1) throw invalid('paymentId', 'invalid');
      return { type: 'PAYMENT', paymentId };
    }
    throw invalid('scope', 'invalid');
  };

  /** The payments a new invoice covers and their reconciled coverages (no writes). */
  const compose = (state: OrderState, scope: InvoiceScope) => {
    if (state.order.orderStatus !== 'OPEN') throw notAvailable();
    const { invoicing } = state;
    const left = (id: number) => invoicing.invoiceable.get(id) ?? 0;
    let payments: any[];
    if (scope.type === 'PAYMENT') {
      const p = invoicing.completedPayments.find((x) => x.id === scope.paymentId);
      if (!p || left(p.id) <= 0) throw notInvoiceable();
      payments = [p];
    } else {
      payments = invoicing.completedPayments.filter((p) => left(p.id) > 0);
      if (!payments.length) throw new EcommerceBillingError('NOTHING_TO_INVOICE');
    }
    const coverages = payments.map((p) => invoicing.reconciled.get(p.id) as ReconciledCoverage);
    const order = state.order;
    const lines = buildInvoiceLines(coverages, invoicing.coverageOrder, {
      reference: 'SHIPPING',
      rates: shippingTaxRates(readShippingLines(order)).map((r) => ({
        ...r,
        name: clean(r.name) || 'Shipping',
      })),
    });
    return {
      payments,
      coverages,
      lines,
      total: lines.reduce((s, l) => s + l.total, 0),
    };
  };

  const customerOf = (order: any): InvoiceCustomer => {
    const c = (order.customerSnapshot ?? {}) as Record<string, unknown>;
    return invoiceCustomer(order.billingAddress ?? null, {
      firstName: clean(c.firstName),
      lastName: clean(c.lastName),
      email: clean(c.email),
    });
  };

  const preview = async (
    rawOrderId: number | string,
    scope: InvoiceScope
  ): Promise<{ lines: InvoiceLine[]; total: number; paymentIds: number[] }> => {
    const state = await orders().computeOrderState(Number(rawOrderId));
    const composed = compose(state, normalizeScope(scope));
    return {
      lines: composed.lines,
      total: composed.total,
      paymentIds: composed.payments.map((p) => p.id),
    };
  };

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
    await history().record({
      orderId,
      type: creditNote ? 'CREDIT_NOTE_ISSUED' : 'INVOICE_ISSUED',
      description: ctx.late
        ? `${describe(row)} ${doc.number} issued after it was marked failed (${row.error ?? 'FAILED'})` +
          (warnings.includes('DUPLICATE_INVOICE')
            ? ': its payment was invoiced again meanwhile, issue a credit note'
            : '')
        : `${describe(row)} ${doc.number} issued (${num(row.total)} cents)`,
      previousValue: ctx.late ? { status: row.status, error: row.error ?? null } : null,
      newValue: {
        invoiceId: row.id,
        kind: row.kind,
        number: doc.number,
        total: num(row.total),
        provider: row.provider,
        ...(creditNote ? { creditedInvoiceId: idOf(row.creditedInvoice) } : {}),
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
   * The provider issued a document for a row an admin had already made FAILED (markFailed, or a
   * reconcile that found nothing yet). The document exists, so it is recorded ISSUED. Each
   * allocation is re-claimed only when its payment has no other active allocation (checked by a
   * query under the order lock); a payment invoiced again meanwhile is flagged DUPLICATE_INVOICE
   * and the customer event is not emitted.
   */
  const recordLateSuccess = async (
    row: any,
    orderId: number,
    doc: IssuedDocument,
    ctx: { actor: string; collector: Collector }
  ) => {
    const q = strapi.db.query(uids().invoiceAllocation);
    const rows: any[] = await q.findMany({
      where: { invoice: { id: row.id } },
      populate: { payment: { select: ['id'] } },
      orderBy: { id: 'asc' },
    });
    let duplicate = false;
    for (const a of rows) {
      const paymentId = idOf(a.payment);
      if (paymentId === null) continue;
      const active = await q.count({
        where: { payment: { id: paymentId }, uniqueKey: { $null: false } },
      });
      if (active > 0) {
        duplicate = true;
        continue;
      }
      await q.update({ where: { id: a.id }, data: { uniqueKey: `payment:${paymentId}` } });
    }
    const warnings = ['ISSUED_AFTER_FAILED', ...(duplicate ? ['DUPLICATE_INVOICE'] : [])];
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
   * Transaction 1 runs `prepare` under the order lock and returns the PENDING row and draft, or
   * `{ failed }` when the document could not be composed (recorded FAILED, rethrown after the
   * commit). Same-key replays and unique-index races are resolved here.
   */
  const twoPhase = async (
    orderId: number,
    key: string,
    kind: InvoiceKind,
    provider: BillingProvider,
    runtime: ProviderRuntime,
    prepare: () => Promise<{ row: any; draft: InvoiceDraft } | { failed: unknown }>,
    actor: string,
    onConflict: () => Error
  ): Promise<InvoiceView> => {
    let prepared: { row: any; draft: InvoiceDraft } | { failed: unknown } | { replay: any };
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
    if ('failed' in prepared) throw prepared.failed;
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

  const isMismatch = (err: unknown): boolean =>
    err instanceof EcommerceValidationError &&
    err.errors.some((e: any) => e?.code === 'coverage_mismatch');

  // ---------------------------------------------------------------------------
  // Issue
  // ---------------------------------------------------------------------------

  const issue = async (
    rawOrderId: number | string,
    rawScope: InvoiceScope,
    input: { idempotencyKey: string },
    actor: string
  ): Promise<InvoiceView> => {
    const orderId = Number(rawOrderId);
    const key = keyOf(input);
    const scope = normalizeScope(rawScope);
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
        const customer = customerOf(order);
        const base = {
          order: orderId,
          provider: provider.id,
          kind: 'INVOICE',
          customerData: customer,
          idempotencyKey: key,
          actor,
          metadata: { locale: order.locale },
        };

        let composed: ReturnType<typeof compose>;
        try {
          composed = compose(state, scope);
        } catch (err) {
          if (!isMismatch(err)) throw err;
          // The coverages do not fit the lines: refused before anything is recorded.
          return { failed: err };
        }

        const row = await createPending({
          ...base,
          total: composed.total,
          lines: { lines: composed.lines },
        });
        for (const [i, p] of composed.payments.entries()) {
          const coverage = composed.coverages[i];
          await strapi.db.query(u.invoiceAllocation).create({
            data: {
              invoice: row.id,
              payment: p.id,
              order: orderId,
              amount: coverage.value,
              coverage: { ...coverage },
              uniqueKey: `payment:${p.id}`,
            },
          });
        }
        const draft: InvoiceDraft = {
          kind: 'INVOICE',
          ourReference: row.ourReference,
          orderReference: `#${order.reference}`,
          date: dateIn(new Date(), tz),
          locale: order.locale,
          customer,
          lines: composed.lines,
          total: composed.total,
          // Σ amounts = total (the lines are built from these coverages).
          payments: composed.payments.map((p, i) => ({
            method: p.method,
            amount: composed.coverages[i].value,
            date: dateIn(p.completedAt, tz),
          })),
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

  /**
   * Credit position of every ISSUED invoice of the order: what each line already has against it
   * (credit notes ISSUED, PENDING or UNCERTAIN) and the suggested credit.
   *
   * Suggestions are carved out of the over-invoiced value (net of credit notes, decremented across
   * invoices so nothing is suggested twice). Returns not yet linked to a credit note come first,
   * with their stored amounts (item values less their share of the discount, up to the return's
   * refundable value); the rest of the over-invoiced value follows (`suggestCreditNote`). The total
   * is capped by `creditNoteBudget`, computed after held refunds were attributed to payments
   * (`refundedByPayment`): a credit note never removes value a refund already removed.
   */
  const creditPosition = async (state: OrderState) => {
    const rows = state.invoicing.invoices;
    const invoices = rows.filter((r) => r.kind === 'INVOICE' && r.status === 'ISSUED');
    const creditNotes = rows.filter((r) => r.kind === 'CREDIT_NOTE' && LIVE.includes(r.status));

    const lines = new Map<number, InvoiceLine[]>(invoices.map((r) => [r.id, linesOf(r)]));
    const credited = new Map<number, number[]>(
      invoices.map((r) => [r.id, lines.get(r.id)!.map(() => 0)])
    );
    for (const cn of creditNotes) {
      const target = credited.get(idOf(cn.creditedInvoice) ?? -1);
      if (!target) continue;
      for (const e of creditedLinesOf(cn)) {
        if (e.index >= 0 && e.index < target.length) target[e.index] += e.value;
      }
    }

    const over: OverInvoiced = overInvoiced(
      { ...state.invoicing.coverageOrder, status: state.order.orderStatus as OrderStatus },
      [
        ...invoices.map((r) => ({ kind: 'INVOICE' as const, lines: lines.get(r.id)! })),
        ...creditNotes.map((r) => ({ kind: 'CREDIT_NOTE' as const, lines: linesOf(r) })),
      ]
    );
    const remaining = new Map(over);
    // Order-level cap: never suggest value a refund already took off a payment not yet invoiced.
    const sum = (values: Iterable<number>) => [...values].reduce((s, v) => s + v, 0);
    let budget = creditNoteBudget(
      { ...state.invoicing.coverageOrder, status: state.order.orderStatus as OrderStatus },
      {
        invoiced: sum(rows.filter((r) => r.kind === 'INVOICE').map((r) => num(r.total))),
        credited: sum(creditNotes.map((r) => num(r.total))),
        invoiceable: sum(state.invoicing.invoiceable.values()),
        kept:
          sum(state.invoicing.completedPayments.map((p) => num(p.amount))) -
          sum(state.invoicing.refunded.values()),
      }
    );
    const suggested = new Map<number, number[]>(
      invoices.map((r) => [r.id, lines.get(r.id)!.map(() => 0)])
    );
    const returnLinks = new Map<number, number[]>(invoices.map((r) => [r.id, []]));

    const take = (invoiceId: number, i: number, want: number): number => {
      const line = lines.get(invoiceId)![i];
      const key = lineKey(line);
      const sug = suggested.get(invoiceId)!;
      const room = line.total - credited.get(invoiceId)![i] - sug[i];
      const t = Math.max(0, Math.min(want, room, remaining.get(key) ?? 0, budget));
      if (t > 0) {
        sug[i] += t;
        remaining.set(key, (remaining.get(key) ?? 0) - t);
        budget -= t;
      }
      return t;
    };

    // Returns not yet credited, with their stored amounts.
    const linked = new Set(creditNotes.flatMap(returnIdsOf));
    const returns: any[] = await strapi.db.query(uids().orderReturn).findMany({
      where: { order: { id: state.order.id } },
      orderBy: { id: 'asc' },
    });
    for (const r of returns) {
      if (linked.has(r.id)) continue;
      const items: { orderLineId: number; value: number }[] = (
        Array.isArray(r.items?.lines) ? r.items.lines : []
      )
        .filter((i: any) => i && Number.isInteger(Number(i.orderLineId)))
        .map((i: any) => ({
          orderLineId: Number(i.orderLineId),
          value: Math.max(0, num(i.value)),
        }));
      const shares = allocateProportionally(
        Math.max(0, num(r.discountShare)),
        items.map((i) => i.value)
      );
      let left = Math.max(0, num(r.refundableValue));
      const touched = new Set<number>();
      items.forEach((item, j) => {
        let want = Math.min(Math.max(0, item.value - shares[j]), left);
        for (const inv of invoices) {
          lines.get(inv.id)!.forEach((l, i) => {
            if (want <= 0 || l.kind !== 'ITEM' || l.orderLineId !== item.orderLineId) return;
            const t = take(inv.id, i, want);
            want -= t;
            left -= t;
            if (t > 0) touched.add(inv.id);
          });
        }
      });
      // Rounding between the return's discount share and the lines' coverage dues: the rest of
      // the refundable value goes to other over-invoiced lines of the same invoices.
      for (const inv of invoices) {
        if (!touched.has(inv.id)) continue;
        lines.get(inv.id)!.forEach((l, i) => {
          if (left > 0 && l.kind === 'ITEM') left -= take(inv.id, i, left);
        });
      }
      for (const id of touched) returnLinks.get(id)!.push(r.id);
    }

    // The rest of the over-invoiced value (removed or reduced lines, cancellation, shipping).
    for (const inv of invoices) {
      const sug = suggested.get(inv.id)!;
      const already = credited.get(inv.id)!.map((v, i) => v + sug[i]);
      const extra = suggestCreditNote({ lines: lines.get(inv.id)! }, already, remaining);
      extra.forEach((want, i) => {
        const v = Math.min(want, budget);
        if (v <= 0) return;
        sug[i] += v;
        budget -= v;
        const key = lineKey(lines.get(inv.id)![i]);
        remaining.set(key, (remaining.get(key) ?? 0) - v);
      });
    }

    return { lines, credited, suggested, returnLinks };
  };

  const loadIssuedInvoice = async (invoiceId: number) => {
    const row = await loadRow(invoiceId);
    if (row.kind !== 'INVOICE' || row.status !== 'ISSUED') throw notAvailable();
    return row;
  };

  const creditNotePreview = async (
    invoiceId: number | string
  ): Promise<{ lines: InvoiceLine[]; creditable: number[]; suggested: number[] }> => {
    const row = await loadIssuedInvoice(Number(invoiceId));
    const state = await orders().computeOrderState(idOf(row.order) as number);
    const position = await creditPosition(state);
    const lines = linesOf(row);
    const credited = position.credited.get(row.id) ?? lines.map(() => 0);
    return {
      lines,
      creditable: lines.map((l, i) => Math.max(0, l.total - credited[i])),
      suggested: position.suggested.get(row.id) ?? lines.map(() => 0),
    };
  };

  const issueCreditNote = async (
    rawInvoiceId: number | string,
    input: CreditNoteInput,
    actor: string
  ): Promise<InvoiceView> => {
    const key = keyOf(input);
    const reason = clean(input?.reason);
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
        const position = await creditPosition(state);
        const originalLines = linesOf(original);
        const alreadyCredited = position.credited.get(original.id) ?? originalLines.map(() => 0);
        const requested = Array.isArray(input?.lines) ? input.lines : [];
        const issues: ValidationIssue[] = validateCreditNoteRequest(
          { lines: originalLines },
          alreadyCredited,
          { lines: requested, reason }
        );
        if (issues.length) throw new EcommerceValidationError('Invalid credit note', issues);

        const byIndex = new Map<number, number>();
        for (const e of requested) byIndex.set(e.index, (byIndex.get(e.index) ?? 0) + e.value);
        const creditedLines = [...byIndex.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, value]) => ({ index, value }));
        const lines = creditedLines.map((e) => creditLine(originalLines[e.index], e.value));
        const total = lines.reduce((s, l) => s + l.total, 0);
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
          metadata: {
            locale,
            reason,
            creditedLines,
            returnIds: position.returnLinks.get(original.id) ?? [],
          },
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
    preview,
    issue,
    reconcile,
    getPdf,
    creditNotePreview,
    issueCreditNote,
    listForOrder,
  };
};

export default EcommerceInvoiceService;
