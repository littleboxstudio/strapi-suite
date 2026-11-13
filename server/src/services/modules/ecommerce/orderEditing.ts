/**
 * Order editing by section (plan 10): each edit runs through the idempotent edit runner
 * (`orderEditRunner.ts`).
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { EcommerceValidationError } from './errors';
import { createEditRunner, type OrderHistoryServiceLike, type OrderServiceLike } from './orderEditRunner';
import {
  appliedOf,
  createOrderModificationSupport,
  toPaymentLike,
  toRefundLike,
  type QuoteUnit,
} from './orderModificationSupport';
import { simulateModification, type ModificationResult } from './domain/orderModification';
import { readReviewFlags } from './domain/orderEditing';
import { chargedShipping, currentMethod, readShippingLines } from './domain/shippingLines';
import { readManualDiscounts } from './domain/manualDiscounts';
import { previousShipmentsCost } from './domain/fulfillment';
import {
  recalculateDiscounts,
  type DiscountLine,
  type DiscountRecalculation,
} from './domain/discountRecalculation';
import type { Address } from './domain/orders';
import type {
  AppliedPromotion,
  BenefitRef,
  EvaluationLine,
  PromotionCandidate,
} from './domain/promotions';
import { isRecord, type CatalogVariant } from './orderPricingHelpers';
import type { ShippingOption, ShippingQuoteRequest } from './shipping';
import { normalizeAddress, type OrderState, type OrderView } from './orders';
import type { ValidationIssue } from './errors';

export type EditKind =
  | 'lines'
  | 'address'
  | 'shipping-recalculate'
  | 'shipping-line-edit'
  | 'shipping-line-add'
  | 'discounts'
  | 'manual-discount-add'
  | 'manual-discount-remove'
  | 'review-dismiss';

export type EditOutcome = { outcome: 'DUE' | 'REFUNDABLE' | 'NONE'; difference: number };

export type EditResult = { order: OrderView } & EditOutcome;

export type LinesInput = { lines: { orderLineId?: number; variantId: number; quantity: number }[] };

export type LinesPreview = Pick<
  ModificationResult,
  'errors' | 'before' | 'after' | 'lineChanges' | 'stockMovements' | 'outcome' | 'difference'
>;

export type ShippingDue =
  | { due: number; quote: number; previousShipmentsCost: number; option: ShippingOption | null }
  | { failed: true };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A line's stored `promotionRefs` (`{ refs }`; a legacy `[]` reads as none). */
const refsOf = (stored: unknown): BenefitRef[] =>
  isRecord(stored) && Array.isArray(stored.refs)
    ? stored.refs
        .filter(isRecord)
        .map((r) => ({
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

const emailOf = (order: any): string | null =>
  typeof order?.customerSnapshot?.email === 'string' ? order.customerSnapshot.email : null;

const invalidLines = (errors: { path: string; code: string }[]) =>
  new EcommerceValidationError('Invalid modification', errors);

const EcommerceOrderEditingService = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): OrderServiceLike => service('EcommerceOrderService');
  const events = (): { collector(): { emit(e: any): void; flush(): Promise<void> } } =>
    service('EcommerceEventBus');
  const shipping = (): {
    findOption(
      req: ShippingQuoteRequest,
      providerId: string,
      serviceId: string
    ): Promise<ShippingOption | null>;
    servedCountries(providerId: string, serviceId: string): Promise<string[]>;
  } => service('EcommerceShippingService');
  const promotions = (): {
    searchLimit(): number;
    loadCandidates(p: { codes: string[]; email: string | null }): Promise<PromotionCandidate[]>;
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

  /**
   * The shipping due for `units` (ruling 6): the cost of the ACTIVE shipments plus a quote of the
   * current method for the units not yet reserved, at `address`. No unit pending: quote 0 and no
   * carrier call. No current method, no option or a carrier error: `{ failed: true }`.
   */
  const shippingDue = async (
    state: OrderState,
    units: QuoteUnit[],
    address: Address | null
  ): Promise<ShippingDue> => {
    const spent = previousShipmentsCost(state.shipments);
    const ids = [...new Set(units.map((u) => u.variantId))];
    const catalog = ids.length
      ? await orders().loadCatalog(ids, state.order.locale)
      : new Map<number, CatalogVariant>();
    const { items, subtotal } = quoteItems(state, units, catalog);
    if (!items.length) return { due: spent, quote: 0, previousShipmentsCost: spent, option: null };
    const method = currentMethod(readShippingLines(state.order));
    if (!method) return { failed: true };
    let option: ShippingOption | null;
    try {
      option = await shipping().findOption(
        {
          country: address?.country ?? '',
          ...(address?.postalCode ? { postalCode: address.postalCode } : {}),
          items,
          subtotal,
          locale: state.order.locale,
        },
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
    const quote = num(option.price);
    return { due: spent + quote, quote, previousShipmentsCost: spent, option };
  };

  /**
   * The order's discounts against today's promotions (ruling 12), with the stored selection.
   * `overrides.lines` replaces the order's lines (a draft).
   */
  const discountEvaluation = async (
    state: OrderState,
    overrides: { lines?: DiscountLine[] } = {}
  ): Promise<DiscountRecalculation> => {
    const order = state.order;
    const rawById = new Map<number, any>((order.lines ?? []).map((l: any) => [l.id, l]));
    const lines =
      overrides.lines ??
      state.lines.map(
        (l): DiscountLine => ({
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
        })
      );
    const codes = codesOf(order);
    const email = emailOf(order);
    const candidates = await promotions().loadCandidates({ codes, email });
    return recalculateDiscounts({
      lines,
      applied: appliedOf(order),
      manual: readManualDiscounts(order),
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
    });
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
        const source = c.sourceOrderLineId !== undefined ? byId.get(c.sourceOrderLineId) : undefined;
        const v = catalog.get(c.variantId);
        added.push({
          variantId: c.variantId,
          sku: source?.sku ?? v?.sku ?? '',
          name: source?.name ?? v?.name ?? '',
          option: source ? source.option : (v?.option ?? null),
          unitPrice: source ? source.unitPrice : num(v?.price),
          quantity: c.newQuantity,
          ...(source ? { sourceOrderLineId: source.id } : {}),
        });
      } else if (c.kind === 'QUANTITY_CHANGED') {
        const l = byId.get(c.orderLineId!)!;
        changed.push({ ...ref(l), previousQuantity: c.previousQuantity, quantity: c.newQuantity });
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
        // The carrier quote may be a remote call: taken before the transaction.
        const due = await shippingDue(
          state,
          draft.lineChanges.map((c) => ({
            variantId: c.variantId,
            quantity: c.newQuantity,
            orderLineId: c.orderLineId,
            sourceOrderLineId: c.sourceOrderLineId,
          })),
          state.order.shippingAddress ?? null
        );
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
        if ('failed' in due) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'SHIPPING_QUOTE_FAILED');
        } else if (due.due !== chargedShipping(readShippingLines(state.order))) {
          flags = await w.raise(flags, 'SHIPPING_REVIEW', 'PRODUCTS_CHANGED');
        }
        const unmet = result.discountWarnings.some((d) => d.code === 'PROMOTION_CONDITION_UNMET');
        const written = await orders().computeOrderState(state.order.id);
        const wouldApply = (await discountEvaluation(written)).rows.some((r) => r.kind === 'NEW');
        if (unmet || wouldApply) {
          flags = await w.raise(flags, 'DISCOUNTS_REVIEW', 'PRODUCTS_CHANGED');
        }

        const totals = await writeTotals(state, { lines: true, reviewFlags: flags });
        return {
          outcome: result.outcome,
          difference: result.difference,
          history: {
            type: 'LINES_CHANGED',
            description: `Products changed: total ${result.before.total} → ${totals.total} cents (${result.outcome})`,
            previousValue: { totals: result.before },
            newValue: {
              ...describeChanges(state, catalog, result.lineChanges),
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
      JSON.stringify(Object.entries((x ?? {}) as Record<string, unknown>).sort(([k], [l]) => (k < l ? -1 : 1)));
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
        if (!(await countriesOf(state)).includes(address.country)) {
          throw new EcommerceValidationError('Invalid address', [
            { path: 'address.country', code: 'COUNTRY_NOT_SERVED' },
          ]);
        }
        // The carrier quote may be a remote call: taken before the transaction.
        const due = await shippingDue(
          state,
          state.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            orderLineId: l.id,
          })),
          address
        );
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

  return { previewLines, applyLines, shippingAddressCountries, updateShippingAddress };
};

export default EcommerceOrderEditingService;
