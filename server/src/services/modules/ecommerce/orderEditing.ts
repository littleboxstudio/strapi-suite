/**
 * Order editing by section (plan 10): each edit runs through the idempotent edit runner
 * (`orderEditRunner.ts`).
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError } from './errors';
import {
  createEditRunner,
  type EditWriter,
  type OrderHistoryServiceLike,
  type OrderServiceLike,
} from './orderEditRunner';
import {
  appliedOf,
  createOrderModificationSupport,
  toPaymentLike,
  toRefundLike,
  type QuoteUnit,
} from './orderModificationSupport';
import {
  modificationOutcome,
  simulateModification,
  type ModificationResult,
  type ModificationTotals,
} from './domain/orderModification';
import {
  clearFlag,
  isReviewFlagCode,
  readReviewFlags,
  type ReviewFlag,
  type ReviewFlagCode,
} from './domain/orderEditing';
import {
  appendLine,
  chargedShipping,
  currentMethod,
  invoicedMethod,
  planLineChange,
  planRecalculation,
  readShippingLines,
  shippingLineViews,
  type ShippingLine,
  type ShippingLineView,
  type ShippingMethodRef,
} from './domain/shippingLines';
import {
  buildManualDiscount,
  readManualDiscounts,
  reconcileManualDiscounts,
  type ManualDiscount,
} from './domain/manualDiscounts';
import { releaseLineRefs } from './domain/lineDiscounts';
import {
  recalculateDiscounts,
  type DiscountLine,
  type DiscountRecalculation,
} from './domain/discountRecalculation';
import { computeTotals, financialSummary, MAX_MONEY_CENTS, type Address } from './domain/orders';
import { normalizeEmail } from './domain/email';
import type {
  AppliedPromotion,
  BenefitRef,
  EvaluationLine,
  PromotionCandidate,
} from './domain/promotions';
import { isRecord, type CatalogVariant } from './orderPricingHelpers';
import type { ShippingOption, ShippingQuoteRequest } from './shipping';
import { normalizeAddress, shippingLineContext, type OrderState, type OrderView } from './orders';
import type { ValidationIssue } from './errors';

export type EditKind =
  | 'lines'
  | 'address'
  | 'billing-address'
  | 'shipping-recalculate'
  | 'shipping-line-edit'
  | 'shipping-line-add'
  | 'discounts'
  | 'manual-discount-add'
  | 'manual-discount-remove'
  | 'review-dismiss';

export type EditOutcome = { outcome: 'DUE' | 'REFUNDABLE' | 'NONE'; difference: number };

export type EditResult = { order: OrderView } & EditOutcome;

/** `discountPercent`: the line's manual discount (spec 4.1); absent, null or '' = none. */
export type LinesInput = {
  lines: { orderLineId?: number; variantId: number; quantity: number; discountPercent?: unknown }[];
};

export type LinesPreview = Pick<
  ModificationResult,
  'errors' | 'before' | 'after' | 'lineChanges' | 'stockMovements' | 'outcome' | 'difference'
>;

/**
 * Spec 6.3. `WHOLE_ORDER` (no shipment, or partially shipped): the whole order is quoted.
 * `NEW_UNITS` (fully shipped, then products added): only the units still to ship, under a method
 * the user picks.
 */
export type RecalculationKind = 'WHOLE_ORDER' | 'NEW_UNITS';

/** A quote of the whole order: `due` is what the shipping charges should add up to. */
export type ShippingDue =
  | { due: number; method: ShippingMethodRef; option: ShippingOption | null }
  | { failed: true };

export type ShippingRecalculationPreview = {
  kind: RecalculationKind;
  /** The charges in scope (WHOLE_ORDER: every line; NEW_UNITS: the lines since the full shipment). */
  charged: number;
  /** The invoiced charges in scope: they stay, the new line charges the quote minus them. */
  invoiced: number;
  quote: number;
  /** The method quoted; null while NEW_UNITS waits for a pick or there is nothing to quote. */
  method: ShippingMethodRef | null;
  /** NEW_UNITS with units to ship: the methods for those units, with their price. */
  options: ShippingOption[];
  /** NEW_UNITS with units to ship and no method picked yet. */
  needsMethod: boolean;
  mode: 'REPLACED' | 'APPENDED' | 'UNCHANGED';
  lines: ShippingLineView[];
  before: ModificationTotals;
  after: ModificationTotals;
};

/** NEW_UNITS: the method picked for the units to ship. */
export type ShippingRecalculationInput = { providerId?: unknown; serviceId?: unknown };

export type ShippingLineInput = { providerId: string; serviceId: string; amount: number };

export type ManualDiscountInput = { kind: 'FIXED' | 'PERCENT'; value: number; reason: string };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A line's stored `promotionRefs` (`{ refs }`; a legacy `[]` reads as none). */
const refsOf = (stored: unknown): BenefitRef[] =>
  isRecord(stored) && Array.isArray(stored.refs)
    ? stored.refs.filter(isRecord).map((r) => ({
        promotionId: num(r.promotionId),
        benefitIndex: num(r.benefitIndex),
        amount: num(r.amount),
      }))
    : [];

/** The codes entered at checkout plus the codes of the applied CODE promotions (ruling 12). */
const codesOf = (order: any): string[] => {
  const entered =
    isRecord(order?.promotions) && Array.isArray(order.promotions.codes)
      ? order.promotions.codes
          .map((c: unknown) => (isRecord(c) ? c.code : null))
          .filter((c: unknown): c is string => typeof c === 'string' && c !== '')
      : [];
  const applied = appliedOf(order)
    .map((a) => a.code)
    .filter((c): c is string => typeof c === 'string' && c !== '');
  return [...new Set([...entered, ...applied])];
};

const invalidDiscounts = (path: string, code: string) =>
  new EcommerceValidationError('Invalid discounts', [{ path, code }]);

/** A selection of row keys, or `required`. */
const normalizeSelection = (raw: unknown): string[] => {
  if (!Array.isArray(raw) || !raw.every((k) => typeof k === 'string')) {
    throw invalidDiscounts('selection', 'required');
  }
  return [...new Set(raw as string[])];
};

const emailOf = (order: any): string | null =>
  typeof order?.customerSnapshot?.email === 'string' ? order.customerSnapshot.email : null;

const invalidLines = (errors: { path: string; code: string }[]) =>
  new EcommerceValidationError('Invalid modification', errors);

const invalidShipping = (path: string, code: string) =>
  new EcommerceValidationError('Invalid shipping', [{ path, code }]);

/** A line amount: integer cents in 0..MAX_MONEY_CENTS (ruling 7). */
const normalizeShippingInput = (input: ShippingLineInput): ShippingLineInput => {
  const amount: unknown = input?.amount;
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount < 0 ||
    amount > MAX_MONEY_CENTS
  ) {
    throw invalidShipping('amount', 'INVALID_AMOUNT');
  }
  return {
    providerId: String(input?.providerId ?? ''),
    serviceId: String(input?.serviceId ?? ''),
    amount,
  };
};

/** Ruling 22: the order has a shipping discount (stored, or an applied shipping promotion). */
const hasShippingDiscount = (order: any): boolean =>
  num(order.shippingDiscount) > 0 ||
  appliedOf(order).some((a) => a.classes.includes('SHIPPING_DISCOUNT'));

const EcommerceOrderEditingService = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): OrderServiceLike => service('EcommerceOrderService');
  const events = (): { collector(): { emit(e: any): void; flush(): Promise<void> } } =>
    service('EcommerceEventBus');
  const shipping = (): {
    quote(
      req: ShippingQuoteRequest
    ): Promise<{ options: ShippingOption[]; failures: { providerId: string; code: string }[] }>;
    findOption(
      req: ShippingQuoteRequest,
      providerId: string,
      serviceId: string
    ): Promise<ShippingOption | null>;
    servedCountries(providerId: string, serviceId: string): Promise<string[]>;
  } => service('EcommerceShippingService');
  const promotions = (): {
    searchLimit(): number;
    loadCandidatesForOrder(p: {
      orderId: number;
      codes: string[];
      email: string | null;
      appliedIds: number[];
    }): Promise<PromotionCandidate[]>;
    reserve(
      applied: AppliedPromotion[],
      ctx: { orderId: number; customerId: number | null; email: string; actor: string }
    ): Promise<void>;
    releasePromotions(orderId: number, promotionIds: number[]): Promise<unknown>;
    unmet(
      applied: AppliedPromotion[],
      ctx: { lines: EvaluationLine[]; email: string | null }
    ): { promotionId: number; name: string }[];
  } => service('EcommercePromotionService');

  const runner = createEditRunner(strapi, {
    orders,
    history: (): OrderHistoryServiceLike => service('EcommerceOrderHistoryService'),
    emit: async (type, event) => {
      const collector = events().collector();
      collector.emit({ type, ...event });
      await collector.flush();
    },
  });
  const { runEdit, assertEditable, writeTotals } = runner;
  const { toModificationCurrent, toModificationCatalog, quoteItems, writeLineChanges } =
    createOrderModificationSupport(strapi);

  // -------------------------------------------------------------------------
  // Shared evaluations (rulings 6 and 12)
  // -------------------------------------------------------------------------

  /** Every unit of the order; `quoteItems` takes off the units already reserved. */
  const orderUnits = (state: OrderState): QuoteUnit[] =>
    state.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, orderLineId: l.id }));

  const catalogFor = (state: OrderState, units: QuoteUnit[]) => {
    const ids = [...new Set(units.map((u) => u.variantId))];
    return ids.length
      ? orders().loadCatalog(ids, state.order.locale)
      : Promise.resolve(new Map<number, CatalogVariant>());
  };

  const quoteRequest = (
    state: OrderState,
    { items, subtotal }: ReturnType<typeof quoteItems>,
    address: Address | null
  ): ShippingQuoteRequest => ({
    country: address?.country ?? '',
    ...(address?.postalCode ? { postalCode: address.postalCode } : {}),
    items,
    subtotal,
    locale: state.order.locale,
  });

  /** `units` counted whole: `quoteItems` takes off the reserved units, so they are added back. */
  const wholeUnits = (state: OrderState, units: QuoteUnit[]): QuoteUnit[] => {
    const byLine = new Map(state.lines.map((l) => [l.id, l]));
    return units.map((u) => {
      const line = u.orderLineId !== undefined ? byLine.get(u.orderLineId) : undefined;
      return line ? { ...u, quantity: u.quantity - line.returnedQuantity + line.reserved } : u;
    });
  };

  /** The method a whole-order quote uses: the invoiced company's, else the current one. */
  const wholeOrderMethod = (state: OrderState): ShippingMethodRef | null =>
    invoicedMethod(state.shippingLines) ?? currentMethod(readShippingLines(state.order));

  /**
   * The shipping the whole order should be charged (spec 6.3): a quote of every unit of `units`
   * (shipped or not) at `address`, under the invoiced company's method (else the current one).
   * Nothing to ship: 0, no carrier call. No method, no option or a carrier error: `{ failed }`.
   */
  const shippingDue = async (
    state: OrderState,
    units: QuoteUnit[],
    address: Address | null
  ): Promise<ShippingDue> => {
    const whole = wholeUnits(state, units);
    const quoted = quoteItems(state, whole, await catalogFor(state, whole));
    const method = wholeOrderMethod(state);
    if (!method) return { failed: true };
    if (!quoted.items.length) return { due: 0, method, option: null };
    let option: ShippingOption | null;
    try {
      option = await shipping().findOption(
        quoteRequest(state, quoted, address),
        method.providerId,
        method.serviceId
      );
    } catch (err) {
      strapi.log?.warn?.(
        `[ecommerce] shipping quote failed for order ${state.order.id} (${(err as any)?.name ?? 'Error'})`
      );
      return { failed: true };
    }
    if (!option) return { failed: true };
    return { due: num(option.price), method, option };
  };

  const timeOf = (v: unknown): number => {
    const t = new Date(v as any).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  /**
   * Spec 6.3: an order that was fully shipped and then got products (the last fulfillment change
   * was FULFILLED → partial, by a products edit) recalculates only the units added since
   * (`NEW_UNITS`, `since` = that change; a still FULFILLED order has none). Any other order
   * with shipments, or without, is quoted whole (`WHOLE_ORDER`).
   */
  const recalculationBasis = (
    state: OrderState
  ): { kind: 'WHOLE_ORDER' } | { kind: 'NEW_UNITS'; since: number | null } => {
    if (!state.editing.hasShipments) return { kind: 'WHOLE_ORDER' };
    if (state.order.fulfillmentStatus === 'FULFILLED') return { kind: 'NEW_UNITS', since: null };
    const history: any[] = [...(state.order.history ?? [])].sort((a, b) => num(a.id) - num(b.id));
    const last = history.filter((h) => h.type === 'FULFILLMENT_STATUS_CHANGED').pop();
    const byProductsEdit =
      last?.previousValue?.fulfillmentStatus === 'FULFILLED' &&
      last.operationId &&
      history.some(
        (h) =>
          h.operationId === last.operationId &&
          (h.type === 'LINES_CHANGED' || h.type === 'ORDER_MODIFIED')
      );
    return byProductsEdit
      ? { kind: 'NEW_UNITS', since: timeOf(last.createdAt) }
      : { kind: 'WHOLE_ORDER' };
  };

  /** The charges a NEW_UNITS recalculation works on: the lines created after `since`. */
  const sinceScope =
    (since: number | null) =>
    (l: ShippingLineView): boolean =>
      since !== null && timeOf(l.createdAt) > since;

  /**
   * The order's discounts against today's promotions (ruling 12), with the stored selection.
   * `overrides.lines` replaces the order's lines (a draft).
   */
  const discountEvaluation = async (
    state: OrderState,
    overrides: { lines?: DiscountLine[]; selection?: string[] } = {}
  ): Promise<DiscountRecalculation> => {
    const order = state.order;
    const rawById = new Map<number, any>((order.lines ?? []).map((l: any) => [l.id, l]));
    const lines =
      overrides.lines ??
      state.lines.map((l): DiscountLine => ({
        id: l.id,
        variantId: l.variantId,
        productId: l.productId,
        isGift: l.isGift,
        shipped: l.shipped,
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        quantity: l.quantity,
        returnedQuantity: l.returnedQuantity,
        refs: refsOf(rawById.get(l.id)?.promotionRefs),
        manualDiscountPercent: l.manualDiscountPercent,
      }));
    const applied = appliedOf(order);
    const appliedIds = applied.map((a) => a.promotionId);
    const email = emailOf(order);
    const candidates = await promotions().loadCandidatesForOrder({
      orderId: order.id,
      codes: codesOf(order),
      email,
      appliedIds,
    });
    // The current code of each applied CODE promotion (loaded by id): a renamed code is not
    // NOT_FOUND.
    const current = candidates
      .filter((c) => c.method === 'CODE' && appliedIds.includes(c.id) && typeof c.code === 'string')
      .map((c) => c.code as string);
    const codes = [...new Set([...codesOf(order), ...current])];
    return recalculateDiscounts(
      {
        lines,
        applied,
        // Capped at the stored order discount: pricing never re-adds a clamped part.
        manual: reconcileManualDiscounts(readManualDiscounts(order), {
          orderDiscount: num(order.orderDiscount),
          promotions: order.promotions,
        }),
        orderDiscount: num(order.orderDiscount),
        shippingGross: chargedShipping(readShippingLines(order)),
        shippingDiscount: num(order.shippingDiscount),
        email,
        codes,
        candidates,
        now: new Date(),
        searchLimit: promotions().searchLimit(),
        payments: state.payments.map(toPaymentLike),
        refunds: state.refunds.map(toRefundLike),
      },
      overrides.selection
    );
  };

  // -------------------------------------------------------------------------
  // Products (spec 4, ruling 20)
  // -------------------------------------------------------------------------

  const normalizeLines = (input: LinesInput): LinesInput['lines'] => {
    const raw: any[] | null = Array.isArray(input?.lines) ? input.lines : null;
    if (!raw) throw invalidLines([{ path: 'lines', code: 'required' }]);
    // Quantities and line ids are validated by the simulation, with per-line paths.
    return raw.map((l) => ({
      ...(l?.orderLineId !== undefined && l?.orderLineId !== null
        ? { orderLineId: Number(l.orderLineId) }
        : {}),
      variantId: Number(l?.variantId),
      quantity: l?.quantity,
      ...(l?.discountPercent !== undefined ? { discountPercent: l.discountPercent } : {}),
    }));
  };

  /** The simulation of `lines` on `state` (shipping KEEP, stored order discount). */
  const simulateLines = async (state: OrderState, lines: LinesInput['lines']) => {
    const ids = new Set<number>(state.lines.map((l) => l.variantId));
    for (const l of lines) {
      if (Number.isSafeInteger(l.variantId) && l.variantId > 0) ids.add(l.variantId);
    }
    const catalog = ids.size
      ? await orders().loadCatalog([...ids], state.order.locale)
      : new Map<number, CatalogVariant>();
    const result = simulateModification(
      toModificationCurrent(state),
      { lines, shipping: { mode: 'KEEP' } },
      toModificationCatalog(catalog),
      { unmet: (applied, c) => promotions().unmet(applied, c) }
    );
    return { catalog, result };
  };

  const loadForLines = async (orderId: number): Promise<OrderState> => {
    const state = await orders().computeOrderState(orderId);
    assertEditable(state, 'ADD_PRODUCTS');
    return state;
  };

  const previewLines = async (
    rawOrderId: number | string,
    input: LinesInput
  ): Promise<LinesPreview> => {
    const lines = normalizeLines(input);
    const state = await loadForLines(Number(rawOrderId));
    const { result: r } = await simulateLines(state, lines);
    return {
      errors: r.errors,
      before: r.before,
      after: r.after,
      lineChanges: r.lineChanges,
      stockMovements: r.stockMovements,
      outcome: r.outcome,
      difference: r.difference,
    };
  };

  /** The history detail of the line changes: added, changed and removed lines. */
  const describeChanges = (
    state: OrderState,
    catalog: Map<number, CatalogVariant>,
    changes: ModificationResult['lineChanges']
  ) => {
    const byId = new Map(state.lines.map((l) => [l.id, l]));
    const ref = (l: OrderState['lines'][number]) => ({
      orderLineId: l.id,
      variantId: l.variantId,
      sku: l.sku,
      name: l.name,
      option: l.option,
    });
    const added: object[] = [];
    const changed: object[] = [];
    const removed: object[] = [];
    for (const c of changes) {
      if (c.kind === 'ADDED') {
        const source =
          c.sourceOrderLineId !== undefined ? byId.get(c.sourceOrderLineId) : undefined;
        const v = catalog.get(c.variantId);
        added.push({
          variantId: c.variantId,
          sku: source?.sku ?? v?.sku ?? '',
          name: source?.name ?? v?.name ?? '',
          option: source ? source.option : (v?.option ?? null),
          unitPrice: source ? source.unitPrice : num(v?.price),
          quantity: c.newQuantity,
          ...(source ? { sourceOrderLineId: source.id } : {}),
          ...(c.discount ? { discountPercent: c.discount.percent } : {}),
        });
      } else if (c.kind === 'QUANTITY_CHANGED' || c.kind === 'DISCOUNT_CHANGED') {
        const l = byId.get(c.orderLineId!)!;
        changed.push({
          ...ref(l),
          previousQuantity: c.previousQuantity,
          quantity: c.newQuantity,
          // Spec 4.1: the manual discount before and after, when it changed.
          ...(c.discount
            ? {
                previousDiscountPercent: c.discount.previousPercent,
                discountPercent: c.discount.percent,
              }
            : {}),
        });
      } else if (c.kind === 'REMOVED') {
        const l = byId.get(c.orderLineId!)!;
        removed.push({ ...ref(l), quantity: c.previousQuantity });
      }
    }
    return { added, changed, removed };
  };

  /**
   * Saves the Products section: only the lines (and stock) change; shipping and discounts stay.
   * Afterwards the shipping due and the discounts are evaluated, in that order, and can only
   * raise review flags (spec 3, 4).
   */
  const applyLines = async (
    rawOrderId: number | string,
    input: LinesInput,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    return runEdit(orderId, 'lines', operationId, actor, {
      prepare: async () => {
        const lines = normalizeLines(input);
        const state = await loadForLines(orderId);
        const { result: draft } = await simulateLines(state, lines);
        if (draft.errors.length) throw invalidLines(draft.errors);
        const units: QuoteUnit[] = draft.lineChanges.map((c) => ({
          variantId: c.variantId,
          quantity: c.newQuantity,
          orderLineId: c.orderLineId,
          sourceOrderLineId: c.sourceOrderLineId,
          ...(c.discount ? { unitDiscount: c.discount.unitDiscount } : {}),
        }));
        // Fully shipped before (spec 6.3): units to ship need a method picked in Recalculate.
        // Edits only add there, so the basis (and its NEW_UNITS) holds after this one too.
        const basis = recalculationBasis(state).kind;
        if (basis === 'NEW_UNITS') {
          const pending = quoteItems(state, units, await catalogFor(state, units));
          return { lines, due: pending.items.length ? ('NEW_UNITS' as const) : null };
        }
        // The carrier quote may be a remote call: taken before the transaction.
        const due = await shippingDue(state, units, state.order.shippingAddress ?? null);
        return { lines, due };
      },
      write: async (state, { lines, due }, w) => {
        assertEditable(state, 'ADD_PRODUCTS');
        const { catalog, result } = await simulateLines(state, lines);
        if (result.errors.length) throw invalidLines(result.errors);
        await writeLineChanges(state, catalog, result, {
          actor: w.actor,
          operationId: w.operationId,
          stockKey: (variantId) => `edit:${w.operationId}:${variantId}`,
        });

        let flags = readReviewFlags(state.order.reviewFlags);
        if (due === 'NEW_UNITS') {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'PRODUCTS_CHANGED');
        } else if (due === null) {
          // Nothing to review.
        } else if ('failed' in due) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'SHIPPING_QUOTE_FAILED');
        } else if (due.due !== chargedShipping(readShippingLines(state.order))) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'PRODUCTS_CHANGED');
        }
        const unmet = result.discountWarnings.some((d) => d.code === 'PROMOTION_CONDITION_UNMET');
        // Spec 4.1: a manual percent that replaced (or a removal that dropped) a promotion discount.
        const replaced = result.lineChanges.some((c) => c.discount?.replacedPromotion);
        // Their promotion discount leaves the stored promotions too, so the promotions, the
        // manual discounts and the line discounts keep adding up to the order's discounts.
        const rawById = new Map<number, any>((state.order.lines ?? []).map((l: any) => [l.id, l]));
        const releasedRefs = result.lineChanges
          .filter((c) => c.discount && c.orderLineId !== undefined)
          .flatMap((c) => refsOf(rawById.get(c.orderLineId!)?.promotionRefs));
        const release = releasedRefs.length
          ? releaseLineRefs(appliedOf(state.order), releasedRefs)
          : null;
        const written = await orders().computeOrderState(state.order.id);
        const wouldApply = (await discountEvaluation(written)).rows.some((r) => r.kind === 'NEW');
        if (unmet || wouldApply || replaced) {
          flags = await w.raise(flags, 'DISCOUNTS_REVIEW', 'PRODUCTS_CHANGED');
        }

        const totals = await writeTotals(state, {
          lines: true,
          reviewFlags: flags,
          ...(release?.released.length
            ? {
                promotions: {
                  ...(isRecord(state.order.promotions) ? state.order.promotions : {}),
                  applied: release.applied,
                },
              }
            : {}),
        });
        return {
          outcome: result.outcome,
          difference: result.difference,
          history: {
            type: 'LINES_CHANGED',
            description: `Products changed: total ${result.before.total} → ${totals.total} cents (${result.outcome})`,
            previousValue: { totals: result.before },
            newValue: {
              ...describeChanges(state, catalog, result.lineChanges),
              ...(release?.released.length
                ? { releasedPromotionDiscounts: release.released }
                : {}),
              totals: result.after,
            },
          },
        };
      },
    });
  };

  // -------------------------------------------------------------------------
  // Shipping address (spec 5, ruling 21)
  // -------------------------------------------------------------------------

  const sameAddress = (a: unknown, b: unknown): boolean => {
    const key = (x: unknown) =>
      JSON.stringify(
        Object.entries((x ?? {}) as Record<string, unknown>).sort(([k], [l]) => (k < l ? -1 : 1))
      );
    return key(a) === key(b);
  };

  const countriesOf = async (state: OrderState): Promise<string[]> => {
    const method = currentMethod(readShippingLines(state.order));
    return method ? shipping().servedCountries(method.providerId, method.serviceId) : [];
  };

  /** The countries the order's current method serves, inside the store markets. */
  const shippingAddressCountries = async (
    rawOrderId: number | string
  ): Promise<{ countries: string[] }> => {
    const state = await orders().computeOrderState(Number(rawOrderId));
    return { countries: await countriesOf(state) };
  };

  /**
   * Saves the shipping address only: amounts never change. The current method is quoted again for
   * the whole order; a different price or a failed quote raises SHIPPING_REVIEW. An unchanged
   * address writes only the runner's idempotency row.
   */
  const updateShippingAddress = async (
    rawOrderId: number | string,
    input: { address: unknown },
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    return runEdit(orderId, 'address', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertEditable(state, 'EDIT_ADDRESS');
        const errors: ValidationIssue[] = [];
        const address = normalizeAddress(input?.address, 'address', errors);
        if (errors.length) throw new EcommerceValidationError('Invalid address', errors);
        if (sameAddress(address, state.order.shippingAddress)) return { address, due: null };
        // Only a new country is checked: an unchanged one is kept even if no longer served.
        const countryChanged =
          String(address.country).toUpperCase() !==
          String(state.order.shippingAddress?.country ?? '').toUpperCase();
        if (countryChanged && !(await countriesOf(state)).includes(address.country)) {
          throw new EcommerceValidationError('Invalid address', [
            { path: 'address.country', code: 'COUNTRY_NOT_SERVED' },
          ]);
        }
        // The carrier quote may be a remote call: taken before the transaction.
        const due = await shippingDue(state, orderUnits(state), address);
        return { address, due };
      },
      write: async (state, { address, due }, w) => {
        assertEditable(state, 'EDIT_ADDRESS');
        const before = state.order.shippingAddress ?? null;
        if (sameAddress(address, before)) {
          return {
            outcome: 'NONE',
            difference: 0,
            history: {
              type: 'ADDRESS_CHANGED',
              description: 'Shipping address unchanged',
              previousValue: null,
              newValue: { unchanged: true },
            },
          };
        }
        let flags = readReviewFlags(state.order.reviewFlags);
        // No quote taken (the address changed since the preparation): review it.
        if (!due || 'failed' in due) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'SHIPPING_QUOTE_FAILED');
        } else if (due.due !== chargedShipping(readShippingLines(state.order))) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'ADDRESS_CHANGED');
        }
        await writeTotals(state, { shippingAddress: address, reviewFlags: flags });
        return {
          outcome: 'NONE',
          difference: 0,
          history: {
            type: 'ADDRESS_CHANGED',
            description: 'Shipping address changed',
            previousValue: before,
            newValue: address,
          },
        };
      },
    });
  };

  /**
   * Saves the billing address only: amounts and shipping never change. It can change until the
   * order has its first invoice (`BILLING_ADDRESS_LOCKED`, detail = the reason); the invoices
   * keep the customer they were issued with.
   */
  const updateBillingAddress = async (
    rawOrderId: number | string,
    input: { address: unknown },
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    const assertBillingEditable = (state: OrderState) => {
      if (state.billingAddressLock) {
        throw new EcommerceValidationError('Billing address locked', [
          { path: 'order', code: 'BILLING_ADDRESS_LOCKED', detail: state.billingAddressLock },
        ]);
      }
    };
    return runEdit(orderId, 'billing-address', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertBillingEditable(state);
        const errors: ValidationIssue[] = [];
        const address = normalizeAddress(input?.address, 'address', errors);
        if (errors.length) throw new EcommerceValidationError('Invalid address', errors);
        return { address };
      },
      write: async (state, { address }) => {
        assertBillingEditable(state);
        const before = state.order.billingAddress ?? null;
        const unchanged = sameAddress(address, before);
        if (!unchanged) await writeTotals(state, { billingAddress: address });
        return {
          outcome: 'NONE',
          difference: 0,
          history: unchanged
            ? {
                type: 'ADDRESS_CHANGED',
                description: 'Billing address unchanged',
                previousValue: null,
                newValue: { unchanged: true },
              }
            : {
                type: 'ADDRESS_CHANGED',
                description: 'Billing address changed',
                previousValue: { billingAddress: before },
                newValue: { billingAddress: address },
              },
        };
      },
    });
  };

  // -------------------------------------------------------------------------
  // Shipping charges (spec 6, rulings 6, 7, 8 and 22)
  // -------------------------------------------------------------------------

  /**
   * The options for the order at its current address (ruling 7): the pending units, or every
   * effective unit when none is pending.
   */
  const optionsFor = async (state: OrderState) => {
    const pending = orderUnits(state);
    const catalog = await catalogFor(state, pending);
    let quoted = quoteItems(state, pending, catalog);
    if (!quoted.items.length) {
      // `quoteItems` takes off the reserved units: add them back to quote the effective ones.
      quoted = quoteItems(
        state,
        state.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity - l.returnedQuantity + l.reserved,
          orderLineId: l.id,
        })),
        catalog
      );
    }
    return shipping().quote(quoteRequest(state, quoted, state.order.shippingAddress ?? null));
  };

  const shippingOptionsForOrder = async (rawOrderId: number | string) =>
    optionsFor(await orders().computeOrderState(Number(rawOrderId)));

  /**
   * The offered option for `input`'s method. A carrier that failed to quote and offered nothing
   * is `SHIPPING_QUOTE_FAILED`; otherwise a method not offered is `SHIPPING_METHOD_UNAVAILABLE`.
   */
  const offeredMethod = async (
    state: OrderState,
    input: ShippingLineInput
  ): Promise<ShippingMethodRef> => {
    const { options, failures } = await optionsFor(state);
    const o = options.find(
      (x) => x.providerId === input.providerId && x.serviceId === input.serviceId
    );
    if (!o) {
      const failed =
        failures.some((f) => f.providerId === input.providerId) &&
        !options.some((x) => x.providerId === input.providerId);
      throw failed
        ? invalidShipping('shipping', 'SHIPPING_QUOTE_FAILED')
        : invalidShipping('method', 'SHIPPING_METHOD_UNAVAILABLE');
    }
    return { providerId: o.providerId, serviceId: o.serviceId, name: o.name, tax: o.tax };
  };

  /** The totals and balance with `shippingLines` (stored ones when absent), as `writeTotals` does. */
  const totalsWith = (
    state: OrderState,
    shippingLines?: ShippingLine[],
    orderDiscount?: number
  ): ModificationTotals => {
    const order = state.order;
    const gross = shippingLines ? chargedShipping(shippingLines) : num(order.shippingOriginal);
    const totals = computeTotals(
      state.lines.map((l) => ({
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        quantity: l.quantity,
        returnedQuantity: l.returnedQuantity,
      })),
      {
        orderDiscount: orderDiscount ?? num(order.orderDiscount),
        shippingOriginal: gross,
        shippingDiscount: Math.max(0, Math.min(num(order.shippingDiscount), gross)),
      }
    );
    const s = financialSummary(
      totals.total,
      state.payments.map(toPaymentLike),
      state.refunds.map(toRefundLike)
    );
    return { ...totals, paid: s.paid, due: s.due, excess: s.excess };
  };

  /**
   * Persists `next` (null: the table is unchanged). Clears SHIPPING_REVIEW and raises
   * DISCOUNTS_REVIEW when the gross changed on an order with a shipping discount (ruling 22).
   * The shipping discount keeps its euro value, capped at the gross (ruling 8).
   */
  const writeShippingLines = async (
    state: OrderState,
    next: ShippingLine[] | null,
    w: EditWriter
  ) => {
    const before = totalsWith(state);
    const after = next ? totalsWith(state, next) : before;
    let flags: ReviewFlag[] = await w.clear(
      readReviewFlags(state.order.reviewFlags),
      'SHIPPING_REVIEW'
    );
    const grossChanged =
      next !== null && chargedShipping(next) !== chargedShipping(readShippingLines(state.order));
    if (grossChanged && hasShippingDiscount(state.order)) {
      flags = await w.raise(flags, 'DISCOUNTS_REVIEW', 'SHIPPING_CHANGED');
    }
    await writeTotals(state, { ...(next ? { shippingLines: next } : {}), reviewFlags: flags });
    return {
      before,
      after,
      outcome: modificationOutcome(before, after),
      difference: after.total - before.total,
    };
  };

  type Recalculation = {
    kind: RecalculationKind;
    /** The charges the recalculation works on. */
    scope: (l: ShippingLineView) => boolean;
    quote: number;
    method: ShippingMethodRef | null;
    options: ShippingOption[];
    needsMethod: boolean;
  };

  const pickedMethod = (input?: ShippingRecalculationInput) => {
    const providerId = typeof input?.providerId === 'string' ? input.providerId.trim() : '';
    const serviceId = typeof input?.serviceId === 'string' ? input.serviceId.trim() : '';
    return providerId && serviceId ? { providerId, serviceId } : null;
  };

  /**
   * NEW_UNITS: the units added since the full shipment (`since`), shipped or not: each line's
   * quantity minus what the ACTIVE shipments made up to then carried. Counted whole (the reserved
   * units are added back, `quoteItems` takes them off).
   */
  const unitsSince = (state: OrderState, since: number): QuoteUnit[] => {
    const before = new Map<number, number>();
    state.shipmentRows.forEach((row: any, i: number) => {
      const s = state.shipments[i];
      if (!s || s.status !== 'ACTIVE' || timeOf(row.createdAt) > since) return;
      s.items.forEach((it) => before.set(it.orderLineId, (before.get(it.orderLineId) ?? 0) + it.quantity));
    });
    return state.lines
      .map((l) => ({
        variantId: l.variantId,
        quantity: Math.max(0, l.quantity - (before.get(l.id) ?? 0)) + l.reserved,
        orderLineId: l.id,
      }))
      .filter((u) => u.quantity > 0);
  };

  /** The quote Recalculate works with (spec 6.3). May call the carriers: never in a transaction. */
  const recalculationQuote = async (
    state: OrderState,
    input: ShippingRecalculationInput | undefined,
    use: 'preview' | 'apply'
  ): Promise<Recalculation> => {
    assertEditable(state, 'RECALCULATE_SHIPPING');
    const address = state.order.shippingAddress ?? null;
    const basis = recalculationBasis(state);
    if (basis.kind === 'WHOLE_ORDER') {
      const due = await shippingDue(state, orderUnits(state), address);
      if ('failed' in due) throw invalidShipping('shipping', 'SHIPPING_QUOTE_FAILED');
      const method = due.option ? { ...due.method, name: due.option.name, tax: due.option.tax } : due.method;
      return { kind: 'WHOLE_ORDER', scope: () => true, quote: due.due, method, options: [], needsMethod: false };
    }
    const scope = sinceScope(basis.since);
    const none = { kind: 'NEW_UNITS' as const, scope, quote: 0, method: null, options: [], needsMethod: false };
    if (basis.since === null) return none;
    const units = unitsSince(state, basis.since);
    const quoted = quoteItems(state, units, await catalogFor(state, units));
    if (!quoted.items.length) return none;
    const picked = pickedMethod(input);
    if (!picked && use === 'apply') throw invalidShipping('method', 'SHIPPING_METHOD_REQUIRED');
    const { options, failures } = await shipping().quote(quoteRequest(state, quoted, address));
    if (!picked) return { ...none, options, needsMethod: true };
    const o = options.find((x) => x.providerId === picked.providerId && x.serviceId === picked.serviceId);
    if (!o) {
      const failed =
        failures.some((f) => f.providerId === picked.providerId) &&
        !options.some((x) => x.providerId === picked.providerId);
      throw failed
        ? invalidShipping('shipping', 'SHIPPING_QUOTE_FAILED')
        : invalidShipping('method', 'SHIPPING_METHOD_UNAVAILABLE');
    }
    return {
      ...none,
      quote: num(o.price),
      method: { providerId: o.providerId, serviceId: o.serviceId, name: o.name, tax: o.tax },
      options,
    };
  };

  /** The new table: the charges in scope become the quote (invoiced ones stay). */
  const recalculationPlan = (state: OrderState, r: Recalculation, actor: string) => {
    const meta = { at: new Date().toISOString(), actor };
    // Nothing quoted (no units, or no method picked yet): the due is what is charged, unchanged.
    if (!r.method) {
      const charged = chargedShipping(state.shippingLines.filter(r.scope));
      const placeholder = { providerId: '', serviceId: '', name: '', tax: 0 };
      return planRecalculation(state.shippingLines, charged, { method: placeholder, ...meta }, r.scope);
    }
    return planRecalculation(state.shippingLines, r.quote, { method: r.method, ...meta }, r.scope);
  };

  const previewShippingRecalculation = async (
    rawOrderId: number | string,
    input?: ShippingRecalculationInput
  ): Promise<ShippingRecalculationPreview> => {
    const state = await orders().computeOrderState(Number(rawOrderId));
    const r = await recalculationQuote(state, input, 'preview');
    const plan = recalculationPlan(state, r, 'preview');
    return {
      kind: r.kind,
      charged: plan.charged,
      invoiced: plan.invoiced,
      quote: r.quote,
      method: r.method,
      options: r.options,
      needsMethod: r.needsMethod,
      mode: plan.mode,
      lines: shippingLineViews(
        plan.lines,
        shippingLineContext(
          state.invoicing,
          state.editing.hasShipments,
          state.order.shippingDiscount
        )
      ),
      before: totalsWith(state),
      after: plan.mode === 'UNCHANGED' ? totalsWith(state) : totalsWith(state, plan.lines),
    };
  };

  /**
   * Recalculate shipping (spec 6.3). WHOLE_ORDER: the whole order is quoted under the invoiced
   * company's method (else the current one); the non-invoiced charges are replaced by one line
   * of the quote minus the invoiced charges (negative: money back). NEW_UNITS: the units added
   * since the full shipment, under the picked method (`input`), the same way over the charges
   * made since. Equal: the table stays and the flag clears. A failed quote changes nothing.
   */
  const recalculateShipping = async (
    rawOrderId: number | string,
    actor: string,
    operationId: string,
    input?: ShippingRecalculationInput
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    return runEdit(orderId, 'shipping-recalculate', operationId, actor, {
      // The carrier quote may be a remote call: taken before the transaction.
      prepare: async () => recalculationQuote(await orders().computeOrderState(orderId), input, 'apply'),
      write: async (state, r, w) => {
        assertEditable(state, 'RECALCULATE_SHIPPING');
        const plan = recalculationPlan(state, r, w.actor);
        const r2 = await writeShippingLines(state, plan.mode === 'UNCHANGED' ? null : plan.lines, w);
        return {
          outcome: r2.outcome,
          difference: r2.difference,
          history: {
            type: 'SHIPPING_RECALCULATED',
            description: `Shipping recalculated (${r.kind}): charged ${plan.charged} → quote ${r.quote} cents (${plan.mode})`,
            previousValue: { lines: readShippingLines(state.order) },
            newValue: {
              basis: r.kind,
              charged: plan.charged,
              invoiced: plan.invoiced,
              quote: r.quote,
              mode: plan.mode,
              lines: plan.lines,
            },
          },
        };
      },
    });
  };

  const lineNotFound = () => invalidShipping('lineId', 'SHIPPING_LINE_NOT_FOUND');
  /** A paid shipping line is never edited (a new line can still be added). */
  const assertLineNotPaid = (lines: ShippingLineView[], lineId: number) => {
    if (lines.some((l) => l.id === lineId && l.paid)) throw invalidShipping('lineId', 'SHIPPING_LINE_PAID');
  };
  /** A correction line (`editOf`) is edited through its target, never by itself. */
  const editableLine = (lines: ShippingLine[], lineId: number): boolean =>
    lines.some((l) => l.id === lineId && l.editOf == null);

  /**
   * Edit a shipping line (ruling 7): replaced in place while not spent nor invoiced, else an
   * EDIT line with the difference. Only before any shipment.
   */
  const editShippingLine = async (
    rawOrderId: number | string,
    rawLineId: number,
    input: ShippingLineInput,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    const lineId = Number(rawLineId);
    return runEdit(orderId, 'shipping-line-edit', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertEditable(state, 'EDIT_SHIPPING_LINE');
        if (!editableLine(state.shippingLines, lineId)) throw lineNotFound();
        assertLineNotPaid(state.shippingLines, lineId);
        const next = normalizeShippingInput(input);
        return { amount: next.amount, method: await offeredMethod(state, next) };
      },
      write: async (state, next, w) => {
        assertEditable(state, 'EDIT_SHIPPING_LINE');
        if (!editableLine(state.shippingLines, lineId)) throw lineNotFound();
        assertLineNotPaid(state.shippingLines, lineId);
        const plan = planLineChange(state.shippingLines, lineId, next, {
          at: new Date().toISOString(),
          actor: w.actor,
        });
        const r = await writeShippingLines(state, plan.mode === 'UNCHANGED' ? null : plan.lines, w);
        return {
          outcome: r.outcome,
          difference: r.difference,
          history: {
            type: 'SHIPPING_LINE_EDITED',
            description: `Shipping charge ${lineId} edited: ${next.method.name} ${next.amount} cents (${plan.mode})`,
            previousValue: { lines: readShippingLines(state.order) },
            newValue: { lineId, mode: plan.mode, lines: plan.lines },
          },
        };
      },
    });
  };

  /** Add a shipping line (ruling 7): always a MANUAL line, with or without shipments. */
  const addShippingLine = async (
    rawOrderId: number | string,
    input: ShippingLineInput,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    return runEdit(orderId, 'shipping-line-add', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertEditable(state, 'ADD_SHIPPING_LINE');
        const next = normalizeShippingInput(input);
        return { amount: next.amount, method: await offeredMethod(state, next) };
      },
      write: async (state, next, w) => {
        assertEditable(state, 'ADD_SHIPPING_LINE');
        const previous = readShippingLines(state.order);
        const lines = appendLine(previous, {
          origin: 'MANUAL',
          amount: next.amount,
          ...next.method,
          createdAt: new Date().toISOString(),
          actor: w.actor,
        });
        const r = await writeShippingLines(state, lines, w);
        return {
          outcome: r.outcome,
          difference: r.difference,
          history: {
            type: 'SHIPPING_LINE_ADDED',
            description: `Shipping charge added: ${next.method.name} ${next.amount} cents`,
            previousValue: { lines: previous },
            newValue: { lineId: lines[lines.length - 1].id, lines },
          },
        };
      },
    });
  };

  // -------------------------------------------------------------------------
  // Discounts (spec 7, rulings 12–19 and 23)
  // -------------------------------------------------------------------------

  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };

  /** Recalculate discounts for `selection` (the initial one when absent). Writes nothing. */
  const previewDiscounts = async (
    rawOrderId: number | string,
    input: { selection?: string[] }
  ): Promise<DiscountRecalculation> => {
    const selection =
      input?.selection === undefined ? undefined : normalizeSelection(input.selection);
    const state = await orders().computeOrderState(Number(rawOrderId));
    assertEditable(state, 'RECALCULATE_DISCOUNTS');
    return discountEvaluation(state, { selection });
  };

  /** Writes the priced lines and removes the deselected promotions' gift lines (ruling 16). */
  const writeDiscountLines = async (state: OrderState, r: DiscountRecalculation, w: EditWriter) => {
    const lines = strapi.db.query(uids().orderLine);
    for (const l of r.lines) {
      await lines.update({
        where: { id: l.id },
        data: { unitDiscount: l.unitDiscount, promotionRefs: { refs: l.refs } },
      });
    }
    if (!r.removedGiftLines.length) return;
    const byId = new Map(state.lines.map((l) => [l.id, l]));
    const restock = new Map<number, number>();
    for (const g of r.removedGiftLines) {
      restock.set(g.variantId, (restock.get(g.variantId) ?? 0) + g.quantity);
    }
    await writeLineChanges(
      state,
      new Map(),
      {
        lineChanges: r.removedGiftLines.map((g) => ({
          kind: 'REMOVED' as const,
          orderLineId: g.id,
          variantId: g.variantId,
          previousQuantity: byId.get(g.id)?.quantity ?? g.quantity,
          newQuantity: 0,
        })),
        stockMovements: [...restock].map(([variantId, quantity]) => ({ variantId, quantity })),
      },
      {
        actor: w.actor,
        operationId: w.operationId,
        stockKey: (variantId) => `edit:${w.operationId}:${variantId}`,
      }
    );
  };

  /**
   * Confirms a recalculation (spec 7.1): lines and gift lines, usage counts of the added and
   * removed promotions, the stored selection and totals. Clears DISCOUNTS_REVIEW. Allowed whenever
   * the order can be edited, invoiced or shipped.
   */
  const applyDiscounts = async (
    rawOrderId: number | string,
    input: { selection: string[] },
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    return runEdit(orderId, 'discounts', operationId, actor, {
      prepare: async () => {
        const selection = normalizeSelection(input?.selection);
        assertEditable(await orders().computeOrderState(orderId), 'RECALCULATE_DISCOUNTS');
        return selection;
      },
      write: async (state, selection, w) => {
        assertEditable(state, 'RECALCULATE_DISCOUNTS');
        const r = await discountEvaluation(state, { selection });
        if (r.conflicts.length) throw invalidDiscounts('selection', 'PROMOTIONS_NOT_COMBINABLE');
        if (r.rows.some((row) => row.locked && !selection.includes(row.key))) {
          throw invalidDiscounts('selection', 'PROMOTION_GIFT_SHIPPED');
        }
        const order = state.order;
        const stored = appliedOf(order);

        await writeDiscountLines(state, r, w);
        const added = r.applied.filter((a) => r.added.includes(a.promotionId));
        if (added.length) {
          await promotions().reserve(added, {
            orderId,
            customerId: order.customer?.id ?? null,
            email: normalizeEmail(emailOf(order) ?? ''),
            actor: w.actor,
          });
        }
        if (r.removed.length) await promotions().releasePromotions(orderId, r.removed);

        const flags = await w.clear(readReviewFlags(order.reviewFlags), 'DISCOUNTS_REVIEW');
        const totals = await writeTotals(state, {
          lines: true,
          orderDiscount: r.orderDiscount,
          shippingDiscount: r.shippingDiscount,
          manualDiscounts: r.manual,
          promotions: {
            ...(isRecord(order.promotions) ? order.promotions : {}),
            applied: r.applied,
            recalculatedAt: new Date().toISOString(),
          },
          reviewFlags: flags,
        });

        const amountOf = (a: AppliedPromotion) => ({
          promotionId: a.promotionId,
          amount: a.amount,
        });
        const manualIds = r.manual.map((m) => m.id);
        return {
          outcome: modificationOutcome(r.before, r.after),
          difference: totals.total - r.before.total,
          history: {
            type: 'DISCOUNTS_RECALCULATED',
            description: `Discounts recalculated: total ${r.before.total} → ${totals.total} cents`,
            previousValue: { totals: r.before },
            newValue: {
              added: added.map(amountOf),
              removed: stored.filter((a) => r.removed.includes(a.promotionId)).map(amountOf),
              kept: {
                promotions: r.applied.filter((a) => !r.added.includes(a.promotionId)).map(amountOf),
                manual: manualIds,
              },
              removedManual: readManualDiscounts(order)
                .map((m) => m.id)
                .filter((id) => !manualIds.includes(id)),
              totals: r.after,
            },
          },
        };
      },
    });
  };

  /** Adds a manual discount (spec 7.2, ruling 18) on top of the order-level discount. */
  const addManualDiscount = async (
    rawOrderId: number | string,
    input: ManualDiscountInput,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    const build = (state: OrderState, by: string) => {
      const items = readManualDiscounts(state.order);
      const { discount, errors } = buildManualDiscount(input, {
        subtotal: num(state.order.subtotal),
        orderDiscount: num(state.order.orderDiscount),
        nextId: Math.max(0, ...items.map((m) => m.id)) + 1,
        at: new Date().toISOString(),
        actor: by,
      });
      if (!discount) throw new EcommerceValidationError('Invalid discount', errors);
      return { items, discount };
    };
    return runEdit(orderId, 'manual-discount-add', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertEditable(state, 'ADD_DISCOUNT');
        build(state, actor);
      },
      write: async (state, _prepared, w) => {
        assertEditable(state, 'ADD_DISCOUNT');
        const { items, discount } = build(state, w.actor);
        const orderDiscount = num(state.order.orderDiscount) + discount.amount;
        return writeManual(state, orderDiscount, [...items, discount], {
          type: 'MANUAL_DISCOUNT_ADDED',
          description: `Manual discount added: ${discount.amount} cents`,
          previousValue: null,
          newValue: {
            id: discount.id,
            kind: discount.kind,
            percent: discount.percent,
            amount: discount.amount,
            reason: discount.reason,
          },
        });
      },
    });
  };

  /** Persists a manual list change and gives its outcome. */
  const writeManual = async (
    state: OrderState,
    orderDiscount: number,
    items: ManualDiscount[],
    history: {
      type: 'MANUAL_DISCOUNT_ADDED' | 'MANUAL_DISCOUNT_REMOVED';
      description: string;
      previousValue: object | null;
      newValue: object;
    }
  ) => {
    const before = totalsWith(state);
    const after = totalsWith(state, undefined, orderDiscount);
    await writeTotals(state, {
      orderDiscount: after.orderDiscount,
      manualDiscounts: items,
    });
    return {
      outcome: modificationOutcome(before, after),
      difference: after.total - before.total,
      history,
    };
  };

  const manualNotFound = () => invalidDiscounts('discountId', 'MANUAL_DISCOUNT_NOT_FOUND');

  /** Removes a manual discount (spec 7.2): its amount comes off the order-level discount. */
  const removeManualDiscount = async (
    rawOrderId: number | string,
    rawDiscountId: number,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    const discountId = Number(rawDiscountId);
    const find = (state: OrderState) => {
      const items = readManualDiscounts(state.order);
      const item = items.find((m) => m.id === discountId);
      if (!item) throw manualNotFound();
      return { items, item };
    };
    return runEdit(orderId, 'manual-discount-remove', operationId, actor, {
      prepare: async () => {
        const state = await orders().computeOrderState(orderId);
        assertEditable(state, 'REMOVE_DISCOUNT');
        find(state);
      },
      write: async (state) => {
        assertEditable(state, 'REMOVE_DISCOUNT');
        const { items, item } = find(state);
        const orderDiscount = Math.max(0, num(state.order.orderDiscount) - item.amount);
        return writeManual(
          state,
          orderDiscount,
          items.filter((m) => m.id !== discountId),
          {
            type: 'MANUAL_DISCOUNT_REMOVED',
            description: `Manual discount removed: ${item.amount} cents`,
            previousValue: {
              id: item.id,
              kind: item.kind,
              percent: item.percent,
              amount: item.amount,
              reason: item.reason,
            },
            newValue: { id: item.id, amount: item.amount },
          }
        );
      },
    });
  };

  /**
   * Dismisses a raised flag, only once the order can no longer be edited (ruling 23). Persists
   * `reviewFlags` with its own update: `writeTotals` refuses an order that is not OPEN.
   */
  const dismissReviewFlag = async (
    rawOrderId: number | string,
    code: ReviewFlagCode,
    actor: string,
    operationId: string
  ): Promise<EditResult> => {
    const orderId = Number(rawOrderId);
    const check = (state: OrderState) => {
      if (!isReviewFlagCode(code)) throw invalidDiscounts('code', 'invalid');
      if (state.editing.editable) throw invalidDiscounts('code', 'REVIEW_FLAG_NOT_DISMISSABLE');
      const { flags, cleared } = clearFlag(readReviewFlags(state.order.reviewFlags), code);
      if (!cleared) throw invalidDiscounts('code', 'invalid');
      return flags;
    };
    return runEdit(orderId, 'review-dismiss', operationId, actor, {
      prepare: async () => {
        check(await orders().computeOrderState(orderId));
      },
      write: async (state) => {
        const flags = check(state);
        await strapi.db.query(uids().order).update({
          where: { id: orderId },
          data: { reviewFlags: { flags } },
        });
        return {
          outcome: 'NONE',
          difference: 0,
          history: {
            type: 'REVIEW_FLAG_DISMISSED',
            description: `Review flag dismissed: ${code}`,
            previousValue: { code },
            newValue: { code },
          },
        };
      },
    });
  };

  return {
    previewLines,
    applyLines,
    shippingAddressCountries,
    updateShippingAddress,
    shippingOptionsForOrder,
    previewShippingRecalculation,
    recalculateShipping,
    editShippingLine,
    updateBillingAddress,
    addShippingLine,
    previewDiscounts,
    applyDiscounts,
    addManualDiscount,
    removeManualDiscount,
    dismissReviewFlag,
  };
};

export default EcommerceOrderEditingService;
