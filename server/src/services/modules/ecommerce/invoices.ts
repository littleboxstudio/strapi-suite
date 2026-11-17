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
  creditedInvoiceIds,
  creditsInvoice,
  entryInvoiceId,
  fitsPosition,
  readInvoiceDoc,
  type CreditType,
} from './domain/invoiceSelection';
import {
  priceWholeSelection,
  type DiscountItem,
  type PricedWholeSelection,
  type WholeSelectionRequest,
} from './domain/invoiceItems';
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
  refundCreditLine,
  refundCreditOptions,
  refundStoredCreditLine,
  settledDiscountIds,
  settledShippingLineIds,
  type CreditOptions,
  type RefundCreditLineOption,
} from './domain/creditNotes';
import {
  offersRefundElements,
  refundItemsOf,
  refundReservationDocs,
  type RefundItem,
} from './domain/refunds';
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

/**
 * What a new invoice can still take, as whole items (plan 14): empty lists when the order is not
 * OPEN. Every listed item is taken whole: its units, its value.
 */
export type InvoiceSelectionView = {
  /** Order lines with units left to invoice: `value` = units × (unitPrice − unitDiscount). */
  lines: {
    orderLineId: number;
    sku: string;
    name: string;
    option: string | null;
    tax: number;
    isGift: boolean;
    units: number;
    unitPrice: number;
    unitDiscount: number;
    value: number;
  }[];
  /** Shipping lines not invoiced, at their current value (a credit line is negative). */
  shipping: {
    shippingLineId: number;
    name: string;
    tax: number;
    origin: ShippingLineOrigin;
    createdAt: string;
    value: number;
  }[];
  /** Order and shipping discounts not invoiced. */
  discounts: Omit<DiscountItem, 'invoiced'>[];
  /** Available payments, in settlement order: `net` = amount − refunded. */
  payments: { paymentId: number; amount: number; refunded: number; net: number }[];
  /** Excess to refund before invoicing (ruling 10). */
  excess: number;
  /** Shipping invoiced above what the order now charges: a SHIPPING credit note credits it. */
  overInvoiced: { shipping: number };
};

export type IssueInvoiceInput = WholeSelectionRequest & { expectedTotal: number; idempotencyKey: string };

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
  /** The SHIPPING credit note: the shipping invoiced above what the order now charges. */
  shippingAdjustment: { lines: InvoiceLine[]; total: number };
  /**
   * Why a CORRECTION is refused on this invoice (`correction` is then empty): a REFUND credit note
   * credited it (plan 15).
   */
  correctionRefused: 'REFUND_CREDITED_INVOICE' | null;
};

/** What an INVOICED refund's credit note may credit, per ISSUED invoice of the order (plan 15). */
export type RefundCreditNoteOptions = {
  refund: { id: number; amount: number };
  /**
   * Whether a credit note can be issued for this refund now; when false, `invoices` is empty and
   * `reason` is the code issuing would refuse with.
   */
  creditable: boolean;
  reason:
    | 'REFUND_NOT_CREDITABLE'
    | 'REFUND_HAS_CREDIT_NOTE'
    | 'ACTION_NOT_AVAILABLE'
    | 'BILLING_NOT_CONFIGURED'
    | null;
  invoices: RefundElementInvoice[];
  /**
   * The refund's own elements (`metadata.items`, plan 15): the modal starts from them, and issuing
   * exactly them uses their stored values. Empty for a legacy refund or when not creditable.
   */
  selected: RefundItem[];
};

/** The elements of one ISSUED invoice an INVOICED refund (or its credit note) may pick. */
export type RefundElementInvoice = { invoiceId: number; number: string | null; lines: RefundCreditLineOption[] };

export type RefundCreditNoteInput = {
  /** Units of ITEM lines, or a whole SHIPPING line (quantity 1), of each invoice. */
  items: { invoiceId: number; index: number; quantity: number }[];
  idempotencyKey: string;
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
    recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
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
    const orderIds = [
      ...new Set(rows.map((r) => idOf(r.order)).filter((id): id is number => id !== null)),
    ];
    const [allocationRows, creditRows] = await Promise.all([
      strapi.db.query(uids().invoiceAllocation).findMany({
        where: { invoice: { id: { $in: ids } } },
        populate: { invoice: { select: ['id'] }, payment: { select: ['id'] } },
        orderBy: { id: 'asc' },
      }) as Promise<any[]>,
      // A credit note may credit several invoices of its order (plan 15): its entries say which.
      strapi.db.query(uids().invoice).findMany({
        where: {
          kind: 'CREDIT_NOTE',
          status: 'ISSUED',
          $or: [
            { creditedInvoice: { id: { $in: ids } } },
            ...(orderIds.length ? [{ order: { id: { $in: orderIds } } }] : []),
          ],
        },
        populate: { creditedInvoice: { select: ['id'] } },
      }) as Promise<any[]>,
    ]);
    const creditDocs = creditRows.map((cn) => ({ doc: readInvoiceDoc(cn, []), total: num(cn.total) }));
    /** What issued credit notes credited of `invoiceId`: their entries on it (old ones: their total). */
    const creditedOf = (invoiceId: number): number =>
      creditDocs.reduce((s, { doc, total }) => {
        if (!creditsInvoice(doc, invoiceId)) return s;
        if (creditedInvoiceIds(doc).length === 1) return s + total;
        return (
          s +
          doc.creditedLines
            .filter((e) => entryInvoiceId(doc, e) === invoiceId)
            .reduce((v, e) => v + e.value, 0)
        );
      }, 0);
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
      credited: creditedOf(r.id),
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
        populate: { order: { select: ['id'] }, creditedInvoice: { select: ['id'] } },
        orderBy: { id: 'asc' },
      })
    );

  /**
   * The document created with `key`, refusing a key used on another order or kind, or (when
   * `belongs` is given) for another request of the same kind, e.g. another refund's credit note.
   */
  const findByKey = async (
    orderId: number,
    key: string,
    kind: InvoiceKind,
    belongs?: (row: any) => boolean
  ) => {
    const row = await findRow({ idempotencyKey: key });
    if (row && (idOf(row.order) !== orderId || row.kind !== kind || (belongs && !belongs(row)))) {
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

  /** The payments as `priceWholeSelection` reads them: net values and availability. */
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
      return {
        lines: [],
        shipping: [],
        discounts: [],
        payments: [],
        excess,
        overInvoiced: { shipping: 0 },
      };
    }
    const { items } = invoicing;
    const orderLines = new Map(state.lines.map((l) => [l.id, l]));
    const shippingLines = new Map(invoicing.positionOrder.shippingLines.map((l) => [l.id, l]));
    const available = new Set(invoicing.availablePaymentIds);
    return {
      lines: items.lines
        .filter((l) => !l.invoiced && orderLines.has(l.orderLineId))
        .map((l) => {
          const line = orderLines.get(l.orderLineId)!;
          return {
            orderLineId: l.orderLineId,
            sku: line.sku,
            name: line.name,
            option: line.option,
            tax: line.tax,
            isGift: line.isGift,
            units: l.units,
            unitPrice: line.unitPrice,
            unitDiscount: line.unitDiscount,
            value: l.value,
          };
        }),
      shipping: items.shipping
        .filter((s) => !s.invoiced && shippingLines.has(s.shippingLineId))
        .map((s) => {
          const line = shippingLines.get(s.shippingLineId)!;
          return {
            shippingLineId: s.shippingLineId,
            name: line.name,
            tax: line.tax,
            origin: line.origin,
            createdAt: line.createdAt,
            value: s.value,
          };
        }),
      discounts: items.discounts
        .filter((d) => !d.invoiced)
        .map(({ invoiced: _invoiced, ...d }) => d),
      payments: invoicing.completedPayments
        .filter((p) => available.has(p.id))
        .map((p) => {
          const amount = num(p.amount);
          const net = invoicing.paymentNets.get(p.id) ?? 0;
          return { paymentId: p.id as number, amount, refunded: amount - net, net };
        }),
      excess,
      overInvoiced: { shipping: invoicing.position.overInvoiced.shipping },
    };
  };

  /** The history's record of a selection: ids, units, values and shares, never names. */
  const selectionRecord = (priced: PricedWholeSelection) => ({
    lines: priced.lines.map((l) => ({
      orderLineId: l.orderLineId,
      units: l.units,
      value: l.value,
      discountShare: l.discountShare,
    })),
    shippingLineIds: priced.shipping.map((s) => s.shippingLineId),
    discountIds: priced.discounts.map((d) => d.id),
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

  /** The refund a REFUND credit note documents (plan 15), or null. */
  const refundOfCreditNote = async (row: any) => {
    if (row?.kind !== 'CREDIT_NOTE' || row.metadata?.creditType !== 'REFUND') return null;
    const refundId = Number(row.metadata?.refundId);
    if (!Number.isInteger(refundId)) return null;
    return strapi.db.query(uids().refund).findOne({ where: { id: refundId } });
  };

  const refundMetadata = (refund: any): Record<string, unknown> =>
    refund?.metadata && typeof refund.metadata === 'object' ? refund.metadata : {};

  /**
   * Whether `refund` may be documented by a credit note: INVOICED, COMPLETED and not removed (a
   * removed or failed refund no longer lowers the total).
   */
  const refundStillCounts = (refund: any): boolean =>
    !!refund &&
    refund.scope === 'INVOICED' &&
    refund.status === 'COMPLETED' &&
    refundMetadata(refund).removed !== true;

  /**
   * An issued REFUND credit note becomes its refund's credit note, unless the refund already has
   * one or no longer counts (a late success is then flagged DUPLICATE_CREDIT_NOTE instead).
   */
  const claimRefundCreditNote = async (row: any) => {
    const refund = await refundOfCreditNote(row);
    if (!refundStillCounts(refund) || refundMetadata(refund).creditNoteId != null) return;
    await strapi.db.query(uids().refund).update({
      where: { id: refund.id },
      data: { metadata: { ...refundMetadata(refund), creditNoteId: row.id } },
    });
  };

  /** A REFUND credit note that failed (or was refused) frees its refund for a new one. */
  const releaseRefundCreditNote = async (row: any) => {
    const refund = await refundOfCreditNote(row);
    if (!refund || Number(refundMetadata(refund).creditNoteId) !== row.id) return;
    const { creditNoteId: _drop, ...rest } = refundMetadata(refund);
    await strapi.db.query(uids().refund).update({ where: { id: refund.id }, data: { metadata: rest } });
  };

  /**
   * A REFUND credit note that is issued, fails or is refused may change the units refunds hold
   * (a late one of a removed refund counts its units): the fulfillment status is derived again.
   */
  const recalculateForRefundNote = async (row: any, orderId: number, actor: string) => {
    if (row?.kind === 'CREDIT_NOTE' && row.metadata?.creditType === 'REFUND') {
      await orders().recalculate(orderId, { actor });
    }
  };

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
    if (creditType === 'REFUND') await claimRefundCreditNote(row);
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
        ...(creditType === 'REFUND' ? { refundId: row.metadata?.refundId ?? null } : {}),
        ...(row.metadata?.selection ? { selection: row.metadata.selection } : {}),
        warnings,
      },
      actor: ctx.actor,
    });
    await recalculateForRefundNote(row, orderId, ctx.actor);
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
    await releaseRefundCreditNote(row);
    await history().record({
      orderId,
      type: 'INVOICE_FAILED',
      description: `${describe(row)} not issued: the provider refused it (${error}${detail ? `: ${detail}` : ''})`,
      previousValue: null,
      newValue: { kind: row.kind, error, ...(detail ? { detail } : {}) },
      actor,
    });
    await recalculateForRefundNote(row, orderId, actor);
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
    await releaseRefundCreditNote(row);
    await history().record({
      orderId,
      type: 'INVOICE_FAILED',
      description: `${describe(row)} #${row.id} failed (${error})${note}`,
      previousValue: { status: row.status },
      newValue: { invoiceId: row.id, kind: row.kind, error },
      actor,
    });
    await recalculateForRefundNote(row, orderId, actor);
  };

  /**
   * Whether a late credit note credits what is no longer there: its invoice was annulled
   * meanwhile, or another credit note took the value, units or returned units it credits, or an
   * active INVOICED refund without a credit note reserved them (plan 15; a REFUND credit note's own
   * refund left out). The row is FAILED, so `docs` count it out.
   */
  const lateCreditNoteDuplicates = async (row: any, state: OrderState) => {
    const { invoicing } = state;
    const creditNote = readInvoiceDoc(row, []);
    const invoiceIds = creditedInvoiceIds(creditNote);
    if (!invoiceIds.length) return true;
    // A REFUND credit note whose refund is gone, removed, no longer counts, or got another credit
    // note meanwhile.
    if (creditNote.creditType === 'REFUND') {
      const refund = await refundOfCreditNote(row);
      if (!refundStillCounts(refund)) return true;
      const other = refundMetadata(refund).creditNoteId;
      if (other != null && Number(other) !== row.id) return true;
    }
    // Each invoice it credits (one credit note may credit several, plan 15), on its own entries.
    const ownRefundId = creditNote.creditType === 'REFUND' ? Number(row.metadata?.refundId) || null : null;
    const docs = [...invoicing.docs, ...refundReservationDocs(state.refunds, invoicing.docs, ownRefundId)];
    for (const invoiceId of invoiceIds) {
      const original = await findRow({ id: invoiceId });
      if (!original || invoicing.position.annulledInvoiceIds.includes(original.id)) return true;
      const invoice = readInvoiceDoc(original, []);
      const options = creditOptions(invoice, docs, invoicing.positionOrder);
      if (exceedsCreditable(creditNote, invoice, options)) return true;
    }
    return false;
  };

  /**
   * The provider issued a document for a row an admin had already made FAILED (markFailed, or a
   * reconcile that found nothing yet). The document exists, so it is recorded ISSUED. Each
   * allocation is re-claimed only when its payment has no other active allocation (checked by a
   * query under the order lock). A payment invoiced again or refunded meanwhile (its net is below
   * the allocation), or units or shipping lines the position no longer has left (`fitsPosition`),
   * or discounts another invoice took meanwhile, flag it DUPLICATE_INVOICE; a credit note whose value was credited again (or whose invoice was
   * annulled) meanwhile is flagged DUPLICATE_CREDIT_NOTE. A flagged document emits no customer
   * event.
   */
  /** A DISCOUNT line of `row` whose discount item another invoice took meanwhile. */
  const discountsTakenMeanwhile = (row: any, discounts: DiscountItem[]): boolean => {
    const invoiced = new Set(discounts.filter((d) => d.invoiced).map((d) => d.id));
    return readInvoiceLines(row.lines).some(
      (l) => l.kind === 'DISCOUNT' && !!l.discountId && invoiced.has(l.discountId)
    );
  };

  const recordLateSuccess = async (
    row: any,
    orderId: number,
    doc: IssuedDocument,
    ctx: { actor: string; collector: Collector }
  ) => {
    // The row is FAILED, so the position is computed without it (ruling 14).
    const state = await orders().computeOrderState(orderId);
    const { invoicing } = state;
    const creditNote = row.kind === 'CREDIT_NOTE';
    let duplicate = creditNote
      ? await lateCreditNoteDuplicates(row, state)
      : !fitsPosition(invoicing.position, readInvoiceDoc(row, []), invoicing.positionOrder) ||
        discountsTakenMeanwhile(row, invoicing.items.discounts);
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
    onConflict: () => Error,
    belongs?: (row: any) => boolean
  ): Promise<InvoiceView> => {
    let prepared: { row: any; draft: InvoiceDraft } | { replay: any };
    try {
      prepared = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        // A request with the same key that held the lock first already answered.
        const winner = await findByKey(orderId, key, kind, belongs);
        if (winner) return { replay: winner };
        return prepare();
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, key, kind, belongs);
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
   * Issues one invoice for whole items (plan 14): order lines (all their units left), shipping
   * lines and discounts, paid by the selected payments. The order is OPEN, no excess is left to
   * refund, lines + shipping − discounts equals the payments' net values, and `expectedTotal` is
   * the total the admin saw. Every check runs before anything is written.
   *
   * Stored lines: ITEM and SHIPPING lines net of their `discountShare` (the selected discounts
   * spread over them), so they add up to the total; one DISCOUNT line per selected discount, a
   * record of what was invoiced (never added to the total again).
   */
  const issue = async (
    rawOrderId: number | string,
    input: IssueInvoiceInput,
    actor: string
  ): Promise<InvoiceView> => {
    const orderId = Number(rawOrderId);
    const key = keyOf(input);
    // Invoices take whole items: a request in the old shape (lines with quantities) is refused.
    if ((input as { lines?: unknown } | undefined)?.lines !== undefined) {
      throw invalid('orderLineIds', 'required');
    }
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
        const { selection: priced, issues } = priceWholeSelection(
          invoicing.items,
          selectablePayments(state),
          {
            orderLineIds: input?.orderLineIds,
            shippingLineIds: input?.shippingLineIds,
            discountIds: input?.discountIds,
            paymentIds: input?.paymentIds,
          }
        );
        if (!priced) throw new EcommerceValidationError('Invalid invoice', issues);
        if (input?.expectedTotal !== priced.total) {
          throw new EcommerceValidationError('Invalid invoice', [
            { path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: String(priced.total) },
          ]);
        }

        const orderLines = new Map(state.lines.map((l) => [l.id, l]));
        const shippingLines = new Map(invoicing.positionOrder.shippingLines.map((l) => [l.id, l]));
        const labels = new Map(invoicing.items.discounts.map((d) => [d.id, d.label]));
        const lines: InvoiceLine[] = [
          ...priced.lines.map((l) => {
            const line = orderLines.get(l.orderLineId)!;
            return {
              orderLineId: l.orderLineId,
              kind: 'ITEM' as const,
              sku: line.sku,
              name: line.option ? `${line.name} - ${line.option}` : line.name,
              quantity: l.units,
              total: l.value - l.discountShare,
              grossTotal: line.unitPrice * l.units,
              tax: line.tax,
              partial: false,
              discountShare: l.discountShare,
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
              total: s.value - s.discountShare,
              grossTotal: s.value,
              tax: line.tax,
              partial: false,
              shippingLineId: s.shippingLineId,
              discountShare: s.discountShare,
            };
          }),
          ...priced.discounts.map((d) => ({
            kind: 'DISCOUNT' as const,
            orderLineId: null,
            sku: 'DISCOUNT',
            name: clean(labels.get(d.id)) || 'Discount',
            quantity: 1,
            total: -d.amount,
            grossTotal: -d.amount,
            tax: 0,
            partial: false,
            discountId: d.id,
          })),
        ];
        // Σ ITEM + SHIPPING = lines + shipping − discounts = the priced total (shares add up to
        // the discounts exactly); the DISCOUNT lines are not added again.
        const documentTotal = lines
          .filter((l) => l.kind !== 'DISCOUNT')
          .reduce((sum, l) => sum + l.total, 0);
        if (documentTotal !== priced.total) {
          throw new EcommerceValidationError('Invalid invoice', [
            { path: 'paymentIds', code: 'INVOICE_TOTALS_DIFFER' },
          ]);
        }
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
          // Σ amounts = total (checked by priceWholeSelection).
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
   * Credit notes ISSUED, PENDING or UNCERTAIN count, so nothing is credited twice. The elements
   * reserved by active INVOICED refunds without a credit note (plan 15) are taken too: a RETURN or
   * SHIPPING credit note never credits them (a CORRECTION is refused while they exist).
   */
  const creditOptionsOf = (original: any, state: OrderState) => {
    const invoice = readInvoiceDoc(original, []);
    const { docs, positionOrder } = state.invoicing;
    const withReservations = [...docs, ...refundReservationDocs(state.refunds, docs)];
    return { invoice, options: creditOptions(invoice, withReservations, positionOrder) };
  };

  /** A credit note on `invoiceId` is PENDING or UNCERTAIN: a CORRECTION must wait for it. */
  const creditNoteInProgress = (invoiceId: number, state: OrderState): boolean =>
    state.invoicing.docs.some(
      (d) =>
        d.kind === 'CREDIT_NOTE' &&
        creditsInvoice(d, invoiceId) &&
        (d.status === 'PENDING' || d.status === 'UNCERTAIN')
    );

  /**
   * A live REFUND credit note credits `invoiceId`, or an active INVOICED refund without a credit
   * note holds elements of it (plan 15): a CORRECTION is refused on it, since annulling the invoice
   * would make its units invoiceable again while the refund keeps them out.
   */
  const refundCredited = (invoiceId: number, state: OrderState): boolean => {
    const { docs } = state.invoicing;
    return [...docs, ...refundReservationDocs(state.refunds, docs)].some(
      (d) =>
        d.kind === 'CREDIT_NOTE' &&
        d.creditType === 'REFUND' &&
        d.status !== 'FAILED' &&
        creditsInvoice(d, invoiceId)
    );
  };

  const creditNotePreview = async (invoiceId: number | string): Promise<CreditNoteOptions> => {
    const row = await loadIssuedInvoice(Number(invoiceId));
    const state = await orders().computeOrderState(idOf(row.order) as number);
    const { invoice, options } = creditOptionsOf(row, state);
    const correctionRefused = refundCredited(row.id, state) ? 'REFUND_CREDITED_INVOICE' : null;
    const correction = correctionRefused
      ? { lines: [], total: 0 }
      : buildCreditLines(invoice, options, {
          creditType: 'CORRECTION',
          lines: [],
          shippingIndexes: [],
        });
    const adjustment = buildCreditLines(invoice, options, {
      creditType: 'SHIPPING',
      lines: [],
      shippingIndexes: [],
    });
    return {
      lines: invoice.lines,
      creditable: options.creditable,
      correction: { lines: correction.lines, total: correction.total },
      shippingAdjustment: { lines: adjustment.lines, total: adjustment.total },
      returnable: options.returnable,
      shipping: options.shipping,
      correctionBlocked: creditNoteInProgress(row.id, state),
      correctionRefused,
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
        if (creditType === 'CORRECTION' && refundCredited(original.id, state)) {
          throw invalid('creditType', 'REFUND_CREDITED_INVOICE');
        }
        const built = buildCreditLines(invoice, options, {
          creditType,
          lines: Array.isArray(input?.lines) ? input.lines : [],
          shippingIndexes: Array.isArray(input?.shippingIndexes) ? input.shippingIndexes : [],
        });
        if (built.issues.length) throw new EcommerceValidationError('Invalid credit note', built.issues);

        const { lines, total, creditedLines } = built;
        // SHIPPING: the negative shipping lines this credit settles are never invoiced again.
        const settled =
          creditType === 'SHIPPING' ? settledShippingLineIds(state.invoicing.items.shipping, total) : [];
        // ... and the shipping discount items it explains with what is left of it.
        const settledLinesValue = state.invoicing.items.shipping
          .filter((s) => settled.includes(s.shippingLineId))
          .reduce((sum, s) => sum - s.value, 0);
        const settledDiscounts =
          creditType === 'SHIPPING'
            ? settledDiscountIds(state.invoicing.items.discounts, total - settledLinesValue)
            : [];
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
            creditType,
            creditedLines,
            ...(settled.length ? { settledShippingLineIds: settled } : {}),
            ...(settledDiscounts.length ? { settledDiscountIds: settledDiscounts } : {}),
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

  // ---------------------------------------------------------------------------
  // Credit note of an INVOICED refund (plan 15)
  // ---------------------------------------------------------------------------

  const loadRefund = async (refundId: number) => {
    const refund = await strapi.db.query(uids().refund).findOne({
      where: { id: refundId },
      populate: { order: { select: ['id'] } },
    });
    if (!refund) throw new EcommerceNotFoundError('Refund not found');
    const orderId = idOf(refund.order);
    if (orderId === null) throw new EcommerceNotFoundError('Order not found');
    return { refund, orderId };
  };

  /** The refund's credit note, unless it FAILED or was discarded (then a new one may be issued). */
  const hasCreditNote = async (refund: any): Promise<boolean> => {
    const id = refundMetadata(refund).creditNoteId;
    if (id == null) return false;
    const row = await findRow({ id: Number(id) });
    return !!row && row.status !== 'FAILED';
  };

  /**
   * The order's ISSUED invoices (of `providerId` when given), not annulled, each with what an
   * INVOICED refund or its credit note may still pick of it: live credit notes counted, and the
   * elements reserved by active INVOICED refunds without a credit note (plan 15), except
   * `exceptRefundId`'s own.
   */
  const refundableInvoices = async (
    orderId: number,
    state: OrderState,
    providerId: string | null,
    exceptRefundId: number | null = null
  ) => {
    const rows: any[] = await strapi.db.query(uids().invoice).findMany({
      where: { order: { id: orderId }, kind: 'INVOICE', status: 'ISSUED' },
      populate: { order: { select: ['id'] }, creditedInvoice: { select: ['id'] } },
      orderBy: { id: 'asc' },
    });
    const annulled = new Set(state.invoicing.position.annulledInvoiceIds);
    const { docs, positionOrder } = state.invoicing;
    const withReservations = [...docs, ...refundReservationDocs(state.refunds, docs, exceptRefundId)];
    return rows
      .filter((r) => offersRefundElements(r, providerId) && !annulled.has(r.id))
      .map((row) => {
        const invoice = readInvoiceDoc(row, []);
        const options = creditOptions(invoice, withReservations, positionOrder);
        return { row, invoice, options, lines: refundCreditOptions(invoice, options) };
      });
  };

  /**
   * The elements a new INVOICED refund may pick (plan 15), per ISSUED invoice of the active billing
   * provider (the one its credit note will use), or of any provider while billing is not active
   * (the refund can then only be removed), with their available values: what live credit notes and
   * other active refunds left. `targets` keeps each invoice and its options for the valuation
   * (`refundCreditLine`). `invoicedRefundable` uses the same invoices.
   */
  const refundElements = async (orderId: number, state: OrderState) => {
    const { providerId } = await billingStatus();
    const targets = await refundableInvoices(orderId, state, providerId);
    return {
      targets,
      invoices: targets
        .filter((t) => t.lines.length > 0)
        .map((t): RefundElementInvoice => ({ invoiceId: t.row.id, number: t.row.number ?? null, lines: t.lines })),
    };
  };

  const refundCreditNoteOptions = async (
    rawRefundId: number | string
  ): Promise<RefundCreditNoteOptions> => {
    const { refund, orderId } = await loadRefund(Number(rawRefundId));
    const billing = await billingStatus();
    const state = await orders().computeOrderState(orderId);
    const base = { refund: { id: refund.id, amount: num(refund.amount) } };
    const none = { invoices: [], selected: [] };
    const reason: RefundCreditNoteOptions['reason'] = !refundStillCounts(refund)
      ? 'REFUND_NOT_CREDITABLE'
      : (await hasCreditNote(refund))
        ? 'REFUND_HAS_CREDIT_NOTE'
        : state.order.orderStatus === 'ARCHIVED'
          ? 'ACTION_NOT_AVAILABLE'
          : !billing.providerId
            ? 'BILLING_NOT_CONFIGURED'
            : null;
    if (reason) return { ...base, creditable: false, reason, ...none };
    // Its own elements are offered; other refunds' reserved elements are not.
    const invoices = await refundableInvoices(orderId, state, billing.providerId!, refund.id);
    return {
      ...base,
      creditable: true,
      reason: null,
      invoices: invoices
        .filter((i) => i.lines.length > 0)
        .map((i) => ({ invoiceId: i.row.id, number: i.row.number ?? null, lines: i.lines })),
      selected: refundItemsOf(refund) ?? [],
    };
  };

  /** Whether a request names exactly the stored elements (same invoice, line and units). */
  const sameElements = (stored: RefundItem[], items: unknown[]): boolean => {
    const elementKey = (i: any) => `${Number(i?.invoiceId)}:${Number(i?.index)}:${Number(i?.quantity)}`;
    const a = stored.map(elementKey).sort();
    const b = items.map(elementKey).sort();
    return a.length === b.length && a.every((k, i) => k === b[i]);
  };

  /**
   * Issues ONE credit note for an INVOICED refund (plan 15), across the order's invoices.
   * - Exactly the refund's own elements (`metadata.items`): their stored values, no re-valuation,
   *   so the total is the refund amount to the cent. Each must still be creditable (what live
   *   credit notes and other refunds left), else `REFUND_ELEMENTS_UNAVAILABLE`.
   * - Any other selection (or a legacy refund): the elements (whole units, valued the RETURN way,
   *   and whole shipping lines) must add up to the refund amount exactly.
   * The refund is COMPLETED, has no credit note yet, the order is
   * not archived and the billing provider is active. `creditedInvoice` is the first invoice; each
   * `creditedLines` entry names its own. The refund's `metadata.creditNoteId` is set with the
   * PENDING row (cleared again if the document fails or is refused).
   */
  const issueRefundCreditNote = async (
    rawRefundId: number | string,
    input: RefundCreditNoteInput,
    actor: string
  ): Promise<InvoiceView> => {
    const key = keyOf(input);
    const refundId = Number(rawRefundId);
    const { orderId } = await loadRefund(refundId);
    // A key replays only this refund's own credit note, never another document's.
    const ofThisRefund = (row: any) => Number(row?.metadata?.refundId) === refundId;

    const existing = await findByKey(orderId, key, 'CREDIT_NOTE', ofThisRefund);
    if (existing) return viewOf(existing.id);

    const { provider, runtime } = await activeProvider();
    if (!provider.capabilities.creditNotes) throw new EcommerceBillingError('NOT_SUPPORTED');
    const tz = await storeTimeZone();

    return twoPhase(
      orderId,
      key,
      'CREDIT_NOTE',
      provider,
      runtime,
      async () => {
        const { refund } = await loadRefund(refundId);
        if (!refundStillCounts(refund)) throw invalid('refund', 'REFUND_NOT_CREDITABLE');
        if (await hasCreditNote(refund)) throw invalid('refund', 'REFUND_HAS_CREDIT_NOTE');
        const state = await orders().computeOrderState(orderId);
        if (state.order.orderStatus === 'ARCHIVED') throw notAvailable();

        const items = Array.isArray(input?.items) ? input.items : [];
        if (!items.length) throw invalid('items', 'required');
        const invoices = await refundableInvoices(orderId, state, provider.id, refund.id);
        const byId = new Map(invoices.map((i) => [i.row.id, i]));
        const issues: { path: string; code: string }[] = [];
        const stored = refundItemsOf(refund);
        const exact = !!stored && sameElements(stored, items);
        const seen = new Set<string>();
        const picked: {
          invoiceId: number;
          index: number;
          line: InvoiceLine;
          value: number;
          quantity: number;
        }[] = [];
        if (exact) {
          stored!.forEach((item, i) => {
            const target = byId.get(item.invoiceId);
            const built = target ? refundStoredCreditLine(target.invoice, target.options, item) : null;
            if (!built) {
              issues.push({ path: `items.${i}`, code: 'REFUND_ELEMENTS_UNAVAILABLE' });
              return;
            }
            picked.push({ invoiceId: item.invoiceId, index: item.index, ...built });
          });
        } else items.forEach((raw, i) => {
          const item: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as any) : {};
          const target = byId.get(Number(item.invoiceId));
          if (!target) {
            issues.push({ path: `items.${i}.invoiceId`, code: 'invalid' });
            return;
          }
          const id = `${target.row.id}:${String(item.index)}`;
          if (seen.has(id)) {
            issues.push({ path: `items.${i}.index`, code: 'duplicate' });
            return;
          }
          seen.add(id);
          const built = refundCreditLine(target.invoice, target.options, item.index, item.quantity);
          if ('issue' in built) {
            issues.push({ path: `items.${i}.${built.issue}`, code: built.code });
            return;
          }
          picked.push({ invoiceId: target.row.id, index: Number(item.index), ...built });
        });
        if (issues.length) throw new EcommerceValidationError('Invalid credit note', issues);
        // In invoice order, then line order: one credit note, each line on its own invoice.
        const order = invoices.map((i) => i.row.id).filter((id) => picked.some((p) => p.invoiceId === id));
        picked.sort(
          (a, b) => order.indexOf(a.invoiceId) - order.indexOf(b.invoiceId) || a.index - b.index
        );
        const valueOf = (invoiceId: number) =>
          picked.filter((p) => p.invoiceId === invoiceId).reduce((s, p) => s + p.value, 0);
        if (order.some((id) => valueOf(id) > byId.get(id)!.options.held)) {
          throw invalid('items', 'CREDIT_EXCEEDS_INVOICE');
        }
        const total = picked.reduce((s, p) => s + p.value, 0);
        if (total !== num(refund.amount)) {
          throw new EcommerceValidationError('Invalid credit note', [
            { path: 'items', code: 'CREDIT_TOTAL_DIFFERS', detail: String(total) },
          ]);
        }

        const first = byId.get(order[0])!.row;
        const locale = clean(first.metadata?.locale) || state.order.locale;
        const customer = (first.customerData ?? customerOf(state.order)) as InvoiceCustomer;
        const reason = (clean(refund.description) || clean(refund.reason) || 'Refund').slice(0, MAX_REASON);
        const lines = picked.map((p) => p.line);
        const row = await createPending({
          order: orderId,
          provider: provider.id,
          kind: 'CREDIT_NOTE',
          creditedInvoice: first.id,
          total,
          lines: { lines },
          customerData: customer,
          idempotencyKey: key,
          actor,
          metadata: {
            locale,
            reason,
            creditType: 'REFUND',
            refundId: refund.id,
            creditedLines: picked.map((p) => ({
              invoiceId: p.invoiceId,
              index: p.index,
              value: p.value,
              quantity: p.quantity,
            })),
          },
        });
        await strapi.db.query(uids().refund).update({
          where: { id: refund.id },
          data: { metadata: { ...refundMetadata(refund), creditNoteId: row.id } },
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
          original: { externalId: String(first.externalId), total: num(first.total) },
          originals: order.map((id) => ({
            externalId: String(byId.get(id)!.row.externalId),
            value: valueOf(id),
          })),
          lineOriginals: picked.map((p) => order.indexOf(p.invoiceId)),
          reason,
        };
        return { row, draft };
      },
      actor,
      () => invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT'),
      ofThisRefund
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
    refundCreditNoteOptions,
    issueRefundCreditNote,
    refundElements,
    listForOrder,
  };
};

export default EcommerceInvoiceService;
