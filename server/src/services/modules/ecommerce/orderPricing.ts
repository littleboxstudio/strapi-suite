/**
 * Cart pricing shared by the order service's `quote` and `create` (no writes). Built by
 * `orders.ts` with its dependencies injected, so this module never imports `orders.ts`.
 */
import type { Core } from '@strapi/strapi';
import { giftChoiceAt, type GiftChoice, type GiftChoices } from './domain/promotions/giftChoices';
import { EcommerceValidationError, type ValidationIssue } from './errors';
import { isValidEmailFormat } from './domain/email';
import { marketCountry } from './domain/markets';
import { manualUnitDiscount } from './domain/lineDiscounts';
import { computeTotals, MAX_MONEY_CENTS } from './domain/orders';
import {
  buildManualDiscountList,
  manualDiscountListShapeErrors,
  manualDiscountTotal,
  type ManualDiscount,
} from './domain/manualDiscounts';
import type { ShippingOption, ShippingQuoteRequest } from './shipping';
import {
  recalculateDiscounts,
  type DiscountBlock,
  type DiscountGift,
  type DiscountLine,
} from './domain/discountRecalculation';
import {
  compatible,
  manualDiscountConflict,
  normalizePromotionCode,
  type StackingConflict,
  type AppliedPromotion,
  type Benefit,
  type DiscountClass,
  type EvaluationInput,
  type GiftOption,
  type GiftUnavailable,
  type PricedLine,
  type PromotionCandidate,
  type PromotionEvaluation,
} from './domain/promotions';
import {
  giftSignature,
  normalizeLines,
  normalizePromotionFields,
  normalizePromotionIds,
  normalizeShippingLines,
  MAX_CREATE_SHIPPING_LINES,
  quantitiesByVariant,
  type CatalogVariant,
  type MergedLine,
  type ShippingLineInput,
} from './orderPricingHelpers';

export type OrderQuoteInput = {
  /** `discountPercent` is read only with `QuoteOptions.manualDiscounts` (admin, spec 4.1). */
  lines: { variantId: number; quantity: number; discountPercent?: number | null }[];
  locale: string;
  email?: string | null;
  promotionCodes?: string[];
  giftChoices?: GiftChoices;
  shipping?: { country: string; postalCode?: string; providerId: string; serviceId: string } | null;
  /** Absent = trusted (admin); `false` = storefront without a verified e-mail. */
  emailVerified?: boolean;
  /** Order-level manual discounts (admin only: read with `QuoteOptions.manualDiscounts`). */
  manualDiscounts?: OrderManualDiscountInput[];
  /**
   * Admin only (`QuoteOptions.admin`): the only automatic promotions to evaluate (entered codes
   * still apply); an empty list evaluates none. Absent: every running automatic promotion.
   */
  promotionIds?: number[];
  /**
   * Admin only (`QuoteOptions.admin`): several shipping charges at amounts the admin entered, the
   * first one being the delivery method. Exclusive with `shipping`; needs `destination`.
   */
  shippingLines?: ShippingLineInput[];
  /** Where `shippingLines` go (the methods are checked against a quote for it). */
  destination?: { country: string; postalCode?: string } | null;
};

/** A manual discount given at creation: FIXED in cents, PERCENT with at most two decimals. */
export type OrderManualDiscountInput = { kind: 'FIXED' | 'PERCENT'; value: number; reason: string };

/** A manual discount as the quote applied it. */
export type QuoteManualDiscount = {
  kind: 'FIXED' | 'PERCENT';
  percent: number | null;
  amount: number;
  reason: string;
};

/** A priced line; `manualDiscountPercent` is set on a line with an admin manual discount. */
export type ManualPricedLine = PricedLine & { manualDiscountPercent?: number };

/**
 * Admin-only pricing options (the storefront never passes them). `manualDiscounts`: the lines'
 * `discountPercent` (spec 4.1) and the order-level `manualDiscounts` are read.
 */
export type QuoteOptions = {
  manualDiscounts?: boolean;
  /** Admin Create order: `promotionIds`, `shippingLines`/`destination` are read. */
  admin?: boolean;
};

/** A shipping charge as the quote priced it (what create stores as a shipping line). */
export type QuoteShippingLine = {
  providerId: string;
  serviceId: string;
  name: string;
  tax: number;
  /** Cents, VAT included. */
  amount: number;
};

export type OrderQuoteLine = PricedLine & {
  /** The manual discount percent (spec 4.1); null = none. */
  manualDiscountPercent: number | null;
  sku: string;
  name: string;
  option: string | null;
  imageUrl: string | null;
  /** VAT rate of the variant (catalog). */
  tax: number;
};

/** A gift benefit (`BUY_X_GET_Y` in `GIFT` mode) of an applied promotion and its variants. */
export type QuoteGiftOption = {
  promotionId: number;
  benefitIndex: number;
  quantity: number;
  /** The variant of this benefit's gift line, null when the benefit gave nothing. */
  selectedVariantId: number | null;
  /** How many gifts the benefit gives (each `quantity` units). Quotes only. */
  repetitions?: number;
  /** The variant of each gift, first to last (`repetitions` entries). Quotes only. */
  selected?: number[];
  variants: {
    variantId: number;
    sku: string;
    name: string;
    option: string | null;
    imageUrl: string | null;
    /** Active and with at least `quantity` units left after the cart's own units. */
    available: boolean;
  }[];
};

export type OrderQuote = {
  lines: OrderQuoteLine[];
  promotions: AppliedPromotion[];
  codes: PromotionEvaluation['codes'];
  rejected: PromotionEvaluation['rejected'];
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    shippingOriginal: number | null;
    shippingDiscount: number;
    shippingTotal: number | null;
    total: number;
    totalDiscount: number;
  };
  shippingOption: ShippingOption | null;
  exhaustive: boolean;
  giftOptions: QuoteGiftOption[];
  /** Promotions met whose gift is out of stock (no gift variant active with stock). */
  giftsUnavailable: GiftUnavailable[];
  /** The order-level manual discounts applied, in input order (empty when none). */
  manualDiscounts: QuoteManualDiscount[];
  /**
   * Admin quotes only: the shipping charges create would store, the first being the delivery
   * method (the single `shipping`: one entry at the carrier's price; none without shipping).
   */
  shippingLines?: QuoteShippingLine[];
};

/**
 * Applies the order-level manual discounts given at creation to a priced cart, as the order's
 * `addManualDiscount` would, one by one, on the new order (shared by `quote` and `create`): on top
 * of the promotions, a PERCENT of the subtotal, each never above the subtotal less the order
 * discounts before it. With none, the evaluation's totals are returned unchanged; otherwise the
 * totals come from `computeTotals`, as the order recomputes them. Throws the indexed errors.
 */
export function applyManualDiscounts(
  e: Pick<PromotionEvaluation, 'subtotal' | 'orderDiscount' | 'shippingDiscount' | 'total'> & {
    lines: Pick<PricedLine, 'unitPrice' | 'unitDiscount' | 'quantity'>[];
  },
  shippingOriginal: number | null,
  raw: unknown,
  ctx: { at: string; actor: string; message: string }
): { items: ManualDiscount[]; orderDiscount: number; total: number } {
  const { items, errors } = buildManualDiscountList(raw, {
    base: e.subtotal,
    pending: e.orderDiscount,
    at: ctx.at,
    actor: ctx.actor,
  });
  if (errors.length) throw new EcommerceValidationError(ctx.message, errors);
  if (!items.length) return { items, orderDiscount: e.orderDiscount, total: e.total };
  const totals = computeTotals(
    e.lines.map((l) => ({
      unitPrice: l.unitPrice,
      unitDiscount: l.unitDiscount,
      quantity: l.quantity,
      returnedQuantity: 0,
    })),
    {
      orderDiscount: e.orderDiscount + manualDiscountTotal(items),
      shippingOriginal: shippingOriginal ?? 0,
      shippingDiscount: e.shippingDiscount,
    }
  );
  return { items, orderDiscount: totals.orderDiscount, total: totals.total };
}

export type PricingDestination = {
  country: string;
  postalCode?: string;
  providerId: string;
  serviceId: string;
};

export type PricedCart = {
  /** Lines with a manual discount carry it at full price (see `priceCart`). */
  evaluation: Omit<PromotionEvaluation, 'lines'> & { lines: ManualPricedLine[] };
  /** The instant every evaluation of this cart used (stored as `evaluatedAt`). */
  evaluatedAt: Date;
  option: ShippingOption | null;
  /** The cart's variants and every gift variant on offer. */
  catalog: Map<number, CatalogVariant>;
  /** Gift variants on offer (stock already net of the cart's units). */
  gifts: Map<number, GiftOption>;
  /**
   * With `shippingLines`: each charge with its offered option (name, tax) and the entered amount.
   * `option` is then the first one's with `price` = its amount.
   */
  shippingLines?: { option: ShippingOption; amount: number }[];
};

/** What pricing needs from the promotion service. */
export type PricingPromotions = {
  evaluate(input: Omit<EvaluationInput, 'searchLimit' | 'onConditionError'>): PromotionEvaluation;
  loadCandidates(p: { codes: string[]; email: string | null; emailVerified?: boolean }): Promise<PromotionCandidate[]>;
  giftOptions(
    candidates: PromotionCandidate[],
    cartQuantities: Map<number, number>
  ): Promise<Map<number, GiftOption>>;
  /** The configured search limit of the engine. */
  searchLimit(): number;
};

/** The cart `applicablePromotions` lists the automatic promotions of (admin Create order). */
export type ApplicablePromotionsInput = {
  lines: { variantId: number; quantity: number; discountPercent?: number | null }[];
  locale: string;
  email?: string | null;
  promotionCodes?: string[];
  giftChoices?: GiftChoices;
  /** The order's shipping charges: only `amount` (cents) is read, their sum is the shipping. */
  shippingLines?: { amount: number }[];
  /** The draft has an order-level manual discount (it blocks what does not stack with it). */
  manualDiscount?: boolean;
};

/** An automatic promotion the cart gets, with what it would take off (cents). */
export type ApplicablePromotion = {
  id: number;
  name: string;
  displayName: Record<string, string>;
  classes: DiscountClass[];
  /** The promotion's benefits as defined (no customer data). */
  benefits: Benefit[];
  /** On its own (a gift promotion: its gift's value). */
  amount: number;
  /** Part of the best combination with the entered codes (never preselected). */
  recommended: boolean;
  /** It does not stack with an entered code's promotion or the draft's manual discount. */
  blockedBy: DiscountBlock | null;
};

export type ApplicablePromotions = {
  promotions: ApplicablePromotion[];
  /** Pairs of selectable promotions that do not stack; `reasons[i]` is from `ids[i]`'s side. */
  conflicts: { ids: [number, number]; reasons: [StackingConflict, StackingConflict] }[];
  /** Per GIFT benefit of the listed promotions, the gift variants on offer. */
  giftOptions: QuoteGiftOption[];
  exhaustive: boolean;
};

/**
 * Each GIFT benefit's variants (texts from `catalog`; a variant no longer in it is left out), as
 * Create order's quote lists them: available when active with enough stock on offer.
 */
/**
 * The variant of each gift a benefit gave, first to last, from its gift lines (one line per
 * variant, `quantity` units per gift): the gift wished for a position when that variant was given,
 * else the next given variant in the benefit's order (the engine's own rule).
 */
export function giftsInOrder(
  giftLines: { variantId: number; quantity: number }[],
  quantity: number,
  variantIds: number[],
  choice: GiftChoice | undefined
): number[] {
  const left = new Map<number, number>();
  for (const l of giftLines) {
    left.set(l.variantId, (left.get(l.variantId) ?? 0) + Math.floor(l.quantity / Math.max(quantity, 1)));
  }
  const total = [...left.values()].reduce((s, n) => s + n, 0);
  const out: number[] = [];
  for (let r = 0; r < total; r += 1) {
    const wished = giftChoiceAt(choice, r);
    const id =
      wished !== undefined && (left.get(wished) ?? 0) > 0
        ? wished
        : variantIds.find((v) => (left.get(v) ?? 0) > 0) ?? [...left.keys()].find((v) => (left.get(v) ?? 0) > 0);
    if (id === undefined) break;
    out.push(id);
    left.set(id, (left.get(id) ?? 0) - 1);
  }
  return out;
}

export function discountGiftOptions(
  gifts: DiscountGift[],
  catalog: Map<number, CatalogVariant>,
  offers: Map<number, GiftOption>
): QuoteGiftOption[] {
  return gifts.map((g) => ({
    promotionId: g.promotionId,
    benefitIndex: g.benefitIndex,
    quantity: g.quantity,
    selectedVariantId: g.selectedVariantId,
    variants: g.variantIds.flatMap((variantId) => {
      const c = catalog.get(variantId);
      if (!c) return [];
      const offer = offers.get(variantId);
      return [
        {
          variantId,
          sku: c.sku,
          name: c.name,
          option: c.option,
          imageUrl: c.imageUrl,
          available: !!offer && offer.active && offer.available >= g.quantity,
        },
      ];
    }),
  }));
}

/**
 * `strapi`, `service` and `getDefaultLocale` are not used by the current pricing code: they are
 * part of the plan-7 interface (C16), reserved for the storefront callers.
 */
export type OrderPricingDeps = {
  strapi: Core.Strapi;
  loadCatalog(variantIds: number[], locale: string): Promise<Map<number, CatalogVariant>>;
  promotions(): PricingPromotions;
  shipping(): {
    findOption(
      req: ShippingQuoteRequest,
      providerId: string,
      serviceId: string
    ): Promise<ShippingOption | null>;
    quote(
      req: ShippingQuoteRequest
    ): Promise<{ options: ShippingOption[]; failures: { providerId: string; code: string }[] }>;
  };
  stock(): { available(ids: number[]): Promise<Map<number, number>> };
  getStoreSettings(): Promise<{ markets?: string[] } | null | undefined>;
  service(name: string): any;
  getDefaultLocale(): Promise<string>;
  clean(v: unknown): string;
  num(v: unknown): number;
};

export const createOrderPricing = (deps: OrderPricingDeps) => {
  const { loadCatalog, promotions, shipping, stock, getStoreSettings, clean, num } = deps;

  /** Lines that are unknown or inactive → VARIANT_UNAVAILABLE; then too few units → INSUFFICIENT_STOCK. */
  const assertLinesAvailable = async (
    lines: MergedLine[],
    catalog: Map<number, CatalogVariant>
  ): Promise<void> => {
    const lineErrors: ValidationIssue[] = [];
    for (const l of lines) {
      if (!catalog.get(l.variantId)?.active)
        lineErrors.push({ path: `lines.${l.index}.variantId`, code: 'VARIANT_UNAVAILABLE' });
    }
    if (lineErrors.length) throw new EcommerceValidationError('Invalid order', lineErrors);

    const available = await stock().available(lines.map((l) => l.variantId));
    for (const l of lines) {
      if ((available.get(l.variantId) ?? 0) < l.quantity) {
        lineErrors.push({ path: `lines.${l.index}.quantity`, code: 'INSUFFICIENT_STOCK' });
      }
    }
    if (lineErrors.length) throw new EcommerceValidationError('Invalid order', lineErrors);
  };

  /**
   * Stock for the priced lines, gifts included, summed per variant. A shortfall is reported on
   * the customer's line of that variant, or on `gifts.<variantId>` for a gift-only variant.
   */
  const assertPricedStock = async (lines: MergedLine[], priced: PricedLine[]): Promise<void> => {
    if (!priced.some((l) => l.isGift)) return;
    const needed = quantitiesByVariant(priced);
    const available = await stock().available([...needed.keys()]);
    const errors: ValidationIssue[] = [];
    for (const [variantId, units] of needed) {
      if ((available.get(variantId) ?? 0) >= units) continue;
      const line = lines.find((l) => l.variantId === variantId);
      errors.push({
        path: line ? `lines.${line.index}.quantity` : `gifts.${variantId}`,
        code: 'INSUFFICIENT_STOCK',
      });
    }
    if (errors.length) throw new EcommerceValidationError('Invalid order', errors);
  };

  /**
   * Prices a cart with its promotions (shared by `quote` and `create`, no writes):
   * 1. candidates and gift options (gift texts in the order's locale);
   * 2. evaluation without shipping → gifts G1;
   * 3. shipping quoted for the lines plus G1 (units summed per variant), on the subtotal after
   *    the order discount of pass 1;
   * 4. evaluation with that shipping; if its gifts differ, one more quote with the new gifts and a
   *    third, final evaluation (at most two shipping quotes);
   * 5. if that final evaluation's gifts differ again from the ones the last shipping quote was for,
   *    the shipping price belongs to another parcel: SHIPPING_UNAVAILABLE rather than a wrong price.
   *
   * `emailVerified` goes to the engine as is (absent = trusted, the admin).
   *
   * A line with `discountPercent` (admin only, spec 4.1) is evaluated frozen at its net price:
   * it takes no line-level promotion but counts in the order-level bases. The evaluation then
   * shows it at its full price with the manual unit discount (subtotal and total unchanged).
   */
  const priceCart = async (p: {
    lines: MergedLine[];
    catalog: Map<number, CatalogVariant>;
    locale: string;
    email: string | null;
    codes: string[];
    giftChoices: GiftChoices;
    destination: PricingDestination | null;
    emailVerified?: boolean;
    /** Admin: the only automatic promotions evaluated (codes still apply). Absent: all. */
    promotionIds?: number[];
    /** Admin: charges at entered amounts (non-empty, needs `destination`). */
    shippingLines?: ShippingLineInput[];
    /** Admin: the cart has an order-level manual discount (with `promotionIds`). */
    manualDiscount?: boolean;
  }): Promise<PricedCart> => {
    const promo = promotions();
    const verified = p.emailVerified === undefined ? {} : { emailVerified: p.emailVerified };
    const loaded = await promo.loadCandidates({ codes: p.codes, email: p.email, ...verified });
    const selected = p.promotionIds === undefined ? null : new Set(p.promotionIds);
    // Only the selected automatic promotions (and their gifts); CODE ones come from the codes.
    const candidates = selected
      ? loaded.filter((c) => c.method !== 'AUTOMATIC' || selected.has(c.id))
      : loaded;
    const gifts = await promo.giftOptions(candidates, quantitiesByVariant(p.lines));
    const catalog = new Map(p.catalog);
    const missing = [...gifts.keys()].filter((id) => !catalog.has(id));
    if (missing.length) {
      for (const [id, entry] of await loadCatalog(missing, p.locale)) catalog.set(id, entry);
    }

    const manual = p.lines.map((l) => {
      if (l.discountPercent === undefined) return null;
      const price = catalog.get(l.variantId)!.price;
      return { percent: l.discountPercent, unitPrice: price, unitDiscount: manualUnitDiscount(price, l.discountPercent) };
    });
    const lines = p.lines.map((l, i) => {
      const c = catalog.get(l.variantId)!;
      const m = manual[i];
      return m
        ? {
            variantId: l.variantId,
            productId: c.productId,
            unitPrice: m.unitPrice - m.unitDiscount,
            quantity: l.quantity,
            frozen: true,
          }
        : { variantId: l.variantId, productId: c.productId, unitPrice: c.price, quantity: l.quantity };
    });
    /** Frozen lines back at full price with their manual discount. */
    const withManual = (e: PromotionEvaluation): PricedCart['evaluation'] => {
      if (!manual.some(Boolean)) return e;
      let added = 0;
      const out: ManualPricedLine[] = e.lines.map((l) => {
        const m = l.sourceIndex === null ? null : manual[l.sourceIndex];
        if (!m) return l;
        added += m.unitDiscount * l.quantity;
        return {
          ...l,
          unitPrice: m.unitPrice,
          unitDiscount: l.unitDiscount + m.unitDiscount,
          manualDiscountPercent: m.percent,
        };
      });
      return {
        ...e,
        lines: out,
        itemsOriginal: e.itemsOriginal + added,
        productDiscount: e.productDiscount + added,
        totalDiscount: e.totalDiscount + added,
      };
    };
    /**
     * Admin `promotionIds`: the selected ones the cart is eligible for must stack together, with
     * the entered codes it is eligible for and with an order-level manual discount, else
     * PROMOTIONS_NOT_COMBINABLE (Apply discount never offers such a selection).
     */
    const assertCombinable = (e: PromotionEvaluation): void => {
      if (!selected) return;
      const eligible = new Set(e.eligible);
      const picked = candidates.filter(
        (c) => c.method === 'AUTOMATIC' && selected.has(c.id) && eligible.has(c.id)
      );
      const codes = candidates.filter((c) => c.method === 'CODE' && eligible.has(c.id));
      // Manual discounts: order-level, or a line's manual percent (exclusive ones never stack).
      const manualDiscount =
        p.manualDiscount === true || p.lines.some((l) => (l.discountPercent ?? 0) > 0);
      const clash = picked.some(
        (a, i) =>
          picked.slice(i + 1).some((b) => !compatible(a, b)) ||
          codes.some((k) => !compatible(a, k)) ||
          (manualDiscount && manualDiscountConflict(a) !== null)
      );
      if (clash) {
        throw new EcommerceValidationError('Invalid order', [
          { path: 'promotionIds', code: 'PROMOTIONS_NOT_COMBINABLE' },
        ]);
      }
    };
    const now = new Date();
    const evaluate = (shippingPrice: number | null) => {
      const e = evaluateRaw(shippingPrice);
      assertCombinable(e);
      return e;
    };
    const evaluateRaw = (shippingPrice: number | null) =>
      withManual(promo.evaluate({
        lines,
        email: p.email,
        ...verified,
        shipping: shippingPrice,
        codes: p.codes,
        candidates,
        gifts,
        giftChoices: p.giftChoices,
        now,
      }));

    const destination = p.destination;
    /** The parcel of `e` (gifts included) at the destination, on its subtotal after promotions. */
    const requestFor = (d: PricingDestination, e: PromotionEvaluation): ShippingQuoteRequest => ({
      country: d.country,
      postalCode: d.postalCode,
      items: [...quantitiesByVariant(e.lines)].map(([variantId, quantity]) => {
        const c = catalog.get(variantId);
        return {
          variantId,
          quantity,
          weight: c?.weight ?? 0,
          width: c?.width ?? 0,
          height: c?.height ?? 0,
          depth: c?.depth ?? 0,
        };
      }),
      subtotal: e.subtotal - e.orderDiscount,
      locale: p.locale,
    });

    if (destination && p.shippingLines?.length) {
      // Entered amounts: the evaluation does not depend on a carrier price, so one pass prices the
      // cart with the whole shipping (shipping promotions apply to the total), and one quote of
      // its parcel checks every method is offered there (name and VAT rate from the offer).
      const evaluation = evaluate(p.shippingLines.reduce((s, l) => s + l.amount, 0));
      const { options, failures } = await shipping().quote(requestFor(destination, evaluation));
      const issues: ValidationIssue[] = [];
      const charged: { option: ShippingOption; amount: number }[] = [];
      p.shippingLines.forEach((l, i) => {
        const o = options.find((x) => x.providerId === l.providerId && x.serviceId === l.serviceId);
        if (o) {
          charged.push({ option: o, amount: l.amount });
          return;
        }
        const failed =
          failures.some((f) => f.providerId === l.providerId) &&
          !options.some((x) => x.providerId === l.providerId);
        issues.push({
          path: `shippingLines.${i}`,
          code: failed ? 'SHIPPING_QUOTE_FAILED' : 'SHIPPING_METHOD_UNAVAILABLE',
        });
      });
      if (issues.length) throw new EcommerceValidationError('Invalid order', issues);
      const option = { ...charged[0].option, price: charged[0].amount };
      return { evaluation, evaluatedAt: now, option, catalog, gifts, shippingLines: charged };
    }

    const first = evaluate(null);
    if (!destination) return { evaluation: first, evaluatedAt: now, option: null, catalog, gifts };

    const quoteFor = async (e: PromotionEvaluation): Promise<ShippingOption> => {
      const option = await shipping().findOption(
        requestFor(destination, e),
        destination.providerId,
        destination.serviceId
      );
      if (!option) {
        throw new EcommerceValidationError('Invalid order', [
          { path: 'shipping', code: 'SHIPPING_UNAVAILABLE' },
        ]);
      }
      return option;
    };

    let option = await quoteFor(first);
    let evaluation = evaluate(num(option.price));
    if (giftSignature(evaluation) !== giftSignature(first)) {
      const quotedFor = evaluation;
      option = await quoteFor(quotedFor);
      evaluation = evaluate(num(option.price));
      if (giftSignature(evaluation) !== giftSignature(quotedFor)) {
        throw new EcommerceValidationError('Invalid order', [
          { path: 'shipping', code: 'SHIPPING_UNAVAILABLE' },
        ]);
      }
    }
    return { evaluation, evaluatedAt: now, option, catalog, gifts };
  };

  /**
   * Entered codes that did not apply: a reached limit → PROMOTION_UNAVAILABLE (409); CONFLICT and
   * NO_BENEFIT are dropped (the order is created without them); anything else →
   * PROMOTION_CODE_INVALID on the entered index with the code's status.
   */
  const assertCodesUsable = (entered: string[], evaluation: PromotionEvaluation): void => {
    const statusOf = new Map(evaluation.codes.map((c) => [c.code, c]));
    const seen = new Set<string>();
    const issues: ValidationIssue[] = [];
    entered.forEach((raw, i) => {
      const code = normalizePromotionCode(raw);
      if (!code || seen.has(code)) return;
      seen.add(code);
      const s = statusOf.get(code);
      // The engine reports every entered code; a missing one is treated as unknown.
      if (!s) {
        issues.push({ path: `promotionCodes.${i}`, code: 'PROMOTION_CODE_INVALID', detail: 'NOT_FOUND' });
        return;
      }
      switch (s.status) {
        case 'APPLIED':
        case 'CONFLICT':
        case 'NO_BENEFIT':
        // The customer saw it in the quote: the order goes on without the gift.
        case 'GIFT_UNAVAILABLE':
          return;
        case 'USAGE_LIMIT_REACHED':
        case 'CUSTOMER_LIMIT_REACHED':
          issues.push({ path: `promotions.${s.promotionId}`, code: 'PROMOTION_UNAVAILABLE', detail: code });
          return;
        default:
          issues.push({ path: `promotionCodes.${i}`, code: 'PROMOTION_CODE_INVALID', detail: s.status });
      }
    });
    if (issues.length) throw new EcommerceValidationError('Invalid order', issues);
  };

  /**
   * One entry per GIFT benefit of the applied promotions, with every variant it offers (texts in
   * the quote's locale; a variant no longer in the catalog is left out).
   */
  const giftOptionsOf = (priced: PricedCart, giftChoices: GiftChoices): QuoteGiftOption[] => {
    const out: QuoteGiftOption[] = [];
    for (const promotion of priced.evaluation.applied) {
      for (const benefit of promotion.benefits) {
        const params = benefit.params;
        if (params.type !== 'BUY_X_GET_Y' || params.get.mode !== 'GIFT') continue;
        const quantity = params.get.quantity;
        const giftLines = priced.evaluation.lines.filter(
          (l) =>
            l.isGift &&
            l.refs.some((r) => r.promotionId === promotion.promotionId && r.benefitIndex === benefit.index)
        );
        const line = giftLines[0];
        const selected = giftsInOrder(
          giftLines,
          quantity,
          params.get.variantIds,
          giftChoices[promotion.promotionId]
        );
        const variants: QuoteGiftOption['variants'] = [];
        for (const variantId of params.get.variantIds) {
          const c = priced.catalog.get(variantId);
          if (!c) continue;
          const gift = priced.gifts.get(variantId);
          variants.push({
            variantId,
            sku: c.sku,
            name: c.name,
            option: c.option,
            imageUrl: c.imageUrl,
            available: !!gift && gift.active && gift.available >= quantity,
          });
        }
        out.push({
          promotionId: promotion.promotionId,
          benefitIndex: benefit.index,
          quantity,
          selectedVariantId: line?.variantId ?? null,
          repetitions: selected.length,
          selected,
          variants,
        });
      }
    }
    return out;
  };

  /** The charges create stores for a priced cart (admin quote's `shippingLines`). */
  const quoteShippingLines = (priced: PricedCart): QuoteShippingLine[] => {
    const charged =
      priced.shippingLines ??
      (priced.option ? [{ option: priced.option, amount: num(priced.option.price) }] : []);
    return charged.map(({ option, amount }) => ({
      providerId: option.providerId,
      serviceId: option.serviceId,
      name: option.name,
      tax: num(option.tax),
      amount,
    }));
  };

  /**
   * The automatic promotions that are active and applicable to a cart (admin Create order's
   * "Apply discount"), each with the amount it would give. The same evaluation as the order
   * detail's Recalculate discounts preview (`recalculateDiscounts`, nothing selected), on the cart
   * as a new order: its lines at catalog prices (a manual percent freezes the line), the entered
   * codes, the gifts on offer and the shipping charges' sum. Writes nothing.
   */
  const applicablePromotions = async (
    input: ApplicablePromotionsInput
  ): Promise<ApplicablePromotions> => {
    const errors: ValidationIssue[] = [];
    const locale = clean(input?.locale);
    if (!locale) errors.push({ path: 'locale', code: 'required' });
    const lines = normalizeLines(input?.lines, errors, { discounts: true });
    const { promotionCodes, giftChoices } = normalizePromotionFields(input, errors);
    const email = clean(input?.email) || null;
    if (email && !isValidEmailFormat(email)) errors.push({ path: 'email', code: 'invalid_email' });
    let shippingGross = 0;
    const rawShipping = input?.shippingLines;
    if (rawShipping !== undefined && rawShipping !== null) {
      if (!Array.isArray(rawShipping) || rawShipping.length > MAX_CREATE_SHIPPING_LINES) {
        errors.push({ path: 'shippingLines', code: 'invalid' });
      } else {
        rawShipping.forEach((l, i) => {
          const amount = (l as { amount?: unknown })?.amount;
          if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > MAX_MONEY_CENTS) {
            errors.push({ path: `shippingLines.${i}.amount`, code: 'INVALID_AMOUNT' });
          } else {
            shippingGross += amount;
          }
        });
      }
    }
    if (errors.length) throw new EcommerceValidationError('Invalid quote', errors);

    const catalog = await loadCatalog(
      lines.map((l) => l.variantId),
      locale
    );
    await assertLinesAvailable(lines, catalog);
    const promo = promotions();
    const candidates = await promo.loadCandidates({ codes: promotionCodes, email });
    const gifts = await promo.giftOptions(candidates, quantitiesByVariant(lines));
    const discountLines: DiscountLine[] = lines.map((l, i) => {
      const c = catalog.get(l.variantId)!;
      const manual = l.discountPercent !== undefined;
      return {
        id: i + 1,
        variantId: l.variantId,
        productId: c.productId,
        isGift: false,
        shipped: 0,
        unitPrice: c.price,
        unitDiscount: manual ? manualUnitDiscount(c.price, l.discountPercent as number) : 0,
        quantity: l.quantity,
        returnedQuantity: 0,
        refs: [],
        manualDiscountPercent: manual ? (l.discountPercent as number) : null,
      };
    });
    // The entered codes' promotions the cart gets are fixed: what does not stack with them is
    // blocked, and the recommendation is made around them.
    const codeCandidates = candidates.filter((c) => c.method === 'CODE');
    const codeApplied = codeCandidates.length
      ? promo.evaluate({
          lines: discountLines.map((l) => ({
            variantId: l.variantId,
            productId: l.productId,
            unitPrice: l.unitPrice - l.unitDiscount,
            quantity: l.quantity,
            ...(l.manualDiscountPercent !== null ? { frozen: true } : {}),
          })),
          email,
          shipping: shippingGross,
          codes: promotionCodes,
          candidates: codeCandidates,
          gifts,
          giftChoices,
          now: new Date(),
        }).applied
      : [];
    const r = recalculateDiscounts(
      {
        lines: discountLines,
        applied: codeApplied,
        manual: [],
        manualOrderDiscount: input?.manualDiscount === true,
        orderDiscount: 0,
        shippingGross,
        shippingDiscount: 0,
        email,
        codes: promotionCodes,
        candidates,
        now: new Date(),
        searchLimit: promo.searchLimit(),
        payments: [],
        refunds: [],
        gifts,
        giftChoices,
      },
      []
    );
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const listed = r.rows.filter(
      (row) => row.kind === 'NEW' && row.method === 'AUTOMATIC' && row.promotionId !== null
    );
    const keys = new Set(listed.map((row) => row.key));
    const idOf = (key: string) => Number(key.slice(2));
    const giftRows = r.gifts.filter((g) => keys.has(`p:${g.promotionId}`));
    const giftCatalog = giftRows.length
      ? await loadCatalog([...new Set(giftRows.flatMap((g) => g.variantIds))], locale)
      : new Map<number, CatalogVariant>();
    return {
      promotions: listed.map((row) => ({
        id: row.promotionId as number,
        name: row.name,
        displayName: row.displayName,
        classes: row.classes,
        benefits: byId.get(row.promotionId as number)?.benefits ?? [],
        amount: row.amount,
        recommended: row.recommended,
        blockedBy: row.blockedBy,
      })),
      conflicts: r.rowConflicts
        .filter((c) => keys.has(c.keys[0]) && keys.has(c.keys[1]))
        .map((c) => ({ ids: [idOf(c.keys[0]), idOf(c.keys[1])], reasons: c.reasons })),
      giftOptions: discountGiftOptions(giftRows, giftCatalog, gifts),
      exhaustive: r.exhaustive,
    };
  };

  /** A cart priced with its promotions, without writing anything (plan 7's entry point). */
  const quote = async (input: OrderQuoteInput, options: QuoteOptions = {}): Promise<OrderQuote> => {
    const errors: ValidationIssue[] = [];
    const locale = clean(input?.locale);
    if (!locale) errors.push({ path: 'locale', code: 'required' });
    const lines = normalizeLines(input?.lines, errors, { discounts: options.manualDiscounts === true });
    const { promotionCodes, giftChoices } = normalizePromotionFields(input, errors);
    const email = clean(input?.email) || null;
    const emailVerified = typeof input?.emailVerified === 'boolean' ? input.emailVerified : undefined;
    if (email && !isValidEmailFormat(email)) errors.push({ path: 'email', code: 'invalid_email' });
    // The storefront never gives an order-level manual discount: the field is ignored.
    const manualInput = options.manualDiscounts === true ? input?.manualDiscounts : undefined;
    errors.push(...manualDiscountListShapeErrors(manualInput));
    // Admin Create order only; the storefront never sends them (ignored).
    const admin = options.admin === true;
    const promotionIds = admin ? normalizePromotionIds(input?.promotionIds, errors) : undefined;
    let shippingLines: ShippingLineInput[] | undefined;
    const hasLines = admin && input?.shippingLines !== undefined && input?.shippingLines !== null;
    if (hasLines && input?.shipping) {
      errors.push({ path: 'shippingLines', code: 'exclusive' });
    } else if (hasLines) {
      shippingLines = normalizeShippingLines(input.shippingLines, errors, MAX_MONEY_CENTS);
    }
    const validCountry = async (raw: unknown, path: string): Promise<string> => {
      const country = clean(raw).toUpperCase();
      if (!country) {
        errors.push({ path, code: 'required' });
        return country;
      }
      const store = await getStoreSettings();
      const countries: string[] = (store?.markets ?? []).map(marketCountry);
      if (!/^[A-Z]{2}$/.test(country) || !countries.includes(country)) {
        errors.push({ path, code: 'invalid_country' });
      }
      return country;
    };

    let destination: PricingDestination | null = null;
    if (shippingLines) {
      const country = await validCountry(input?.destination?.country, 'destination.country');
      const postalCode = clean(input?.destination?.postalCode);
      const first = shippingLines[0];
      destination = {
        country,
        ...(postalCode ? { postalCode } : {}),
        providerId: first?.providerId ?? '',
        serviceId: first?.serviceId ?? '',
      };
    } else if (input?.shipping) {
      const country = clean(input.shipping.country).toUpperCase();
      const providerId = clean(input.shipping.providerId);
      const serviceId = clean(input.shipping.serviceId);
      const postalCode = clean(input.shipping.postalCode);
      if (!providerId || !serviceId) errors.push({ path: 'shipping', code: 'required' });
      await validCountry(input.shipping.country, 'shipping.country');
      destination = { country, ...(postalCode ? { postalCode } : {}), providerId, serviceId };
    }
    if (errors.length) throw new EcommerceValidationError('Invalid quote', errors);

    const catalog = await loadCatalog(
      lines.map((l) => l.variantId),
      locale
    );
    await assertLinesAvailable(lines, catalog);
    const priced = await priceCart({
      lines,
      catalog,
      locale,
      email,
      codes: promotionCodes,
      giftChoices,
      destination,
      emailVerified,
      ...(promotionIds !== undefined ? { promotionIds } : {}),
      ...(shippingLines ? { shippingLines } : {}),
      manualDiscount: Array.isArray(manualInput) && manualInput.length > 0,
    });
    const e = priced.evaluation;
    await assertPricedStock(lines, e.lines);
    const manual = applyManualDiscounts(e, e.shippingOriginal, manualInput, {
      at: new Date().toISOString(),
      actor: '',
      message: 'Invalid quote',
    });
    const manualAmount = manualDiscountTotal(manual.items);

    return {
      lines: e.lines.map((l) => {
        const c = priced.catalog.get(l.variantId);
        return {
          ...l,
          manualDiscountPercent: l.manualDiscountPercent ?? null,
          sku: c?.sku ?? '',
          name: c?.name ?? '',
          option: c?.option ?? null,
          imageUrl: c?.imageUrl ?? null,
          tax: c?.tax ?? 0,
        };
      }),
      promotions: e.applied,
      codes: e.codes,
      rejected: e.rejected,
      totals: {
        itemsOriginal: e.itemsOriginal,
        productDiscount: e.productDiscount,
        subtotal: e.subtotal,
        orderDiscount: manual.orderDiscount,
        shippingOriginal: e.shippingOriginal,
        shippingDiscount: e.shippingDiscount,
        shippingTotal: e.shippingOriginal === null ? null : e.shippingOriginal - e.shippingDiscount,
        total: manual.total,
        totalDiscount: e.totalDiscount + manualAmount,
      },
      shippingOption: priced.option,
      exhaustive: e.exhaustive,
      giftOptions: giftOptionsOf(priced, giftChoices),
      giftsUnavailable: e.giftsUnavailable ?? [],
      manualDiscounts: manual.items.map((m) => ({
        kind: m.kind as QuoteManualDiscount['kind'],
        percent: m.percent,
        amount: m.amount,
        reason: m.reason,
      })),
      ...(admin ? { shippingLines: quoteShippingLines(priced) } : {}),
    };
  };

  return {
    priceCart,
    quote,
    applicablePromotions,
    assertLinesAvailable,
    assertPricedStock,
    assertCodesUsable,
  };
};
