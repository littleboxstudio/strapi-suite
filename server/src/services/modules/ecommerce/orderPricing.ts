/**
 * Cart pricing shared by the order service's `quote` and `create` (no writes). Built by
 * `orders.ts` with its dependencies injected, so this module never imports `orders.ts`.
 */
import type { Core } from '@strapi/strapi';
import { EcommerceValidationError, type ValidationIssue } from './errors';
import { isValidEmailFormat } from './domain/email';
import type { ShippingOption, ShippingQuoteRequest } from './shipping';
import {
  normalizePromotionCode,
  type AppliedPromotion,
  type EvaluationInput,
  type GiftOption,
  type PricedLine,
  type PromotionCandidate,
  type PromotionEvaluation,
} from './domain/promotions';
import {
  giftSignature,
  normalizeLines,
  normalizePromotionFields,
  quantitiesByVariant,
  type CatalogVariant,
  type MergedLine,
} from './orderPricingHelpers';

export type OrderQuoteInput = {
  lines: { variantId: number; quantity: number }[];
  locale: string;
  email?: string | null;
  promotionCodes?: string[];
  giftChoices?: Record<number, number>;
  shipping?: { country: string; postalCode?: string; providerId: string; serviceId: string } | null;
  /** Absent = trusted (admin); `false` = storefront without a verified e-mail. */
  emailVerified?: boolean;
};

export type OrderQuoteLine = PricedLine & {
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
};

export type PricingDestination = {
  country: string;
  postalCode?: string;
  providerId: string;
  serviceId: string;
};

export type PricedCart = {
  evaluation: PromotionEvaluation;
  /** The instant every evaluation of this cart used (stored as `evaluatedAt`). */
  evaluatedAt: Date;
  option: ShippingOption | null;
  /** The cart's variants and every gift variant on offer. */
  catalog: Map<number, CatalogVariant>;
  /** Gift variants on offer (stock already net of the cart's units). */
  gifts: Map<number, GiftOption>;
};

/** What pricing needs from the promotion service. */
export type PricingPromotions = {
  evaluate(input: Omit<EvaluationInput, 'searchLimit' | 'onConditionError'>): PromotionEvaluation;
  loadCandidates(p: { codes: string[]; email: string | null; emailVerified?: boolean }): Promise<PromotionCandidate[]>;
  giftOptions(
    candidates: PromotionCandidate[],
    cartQuantities: Map<number, number>
  ): Promise<Map<number, GiftOption>>;
};

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
   */
  const priceCart = async (p: {
    lines: MergedLine[];
    catalog: Map<number, CatalogVariant>;
    locale: string;
    email: string | null;
    codes: string[];
    giftChoices: Record<number, number>;
    destination: PricingDestination | null;
    emailVerified?: boolean;
  }): Promise<PricedCart> => {
    const promo = promotions();
    const verified = p.emailVerified === undefined ? {} : { emailVerified: p.emailVerified };
    const candidates = await promo.loadCandidates({ codes: p.codes, email: p.email, ...verified });
    const gifts = await promo.giftOptions(candidates, quantitiesByVariant(p.lines));
    const catalog = new Map(p.catalog);
    const missing = [...gifts.keys()].filter((id) => !catalog.has(id));
    if (missing.length) {
      for (const [id, entry] of await loadCatalog(missing, p.locale)) catalog.set(id, entry);
    }

    const lines = p.lines.map((l) => {
      const c = catalog.get(l.variantId)!;
      return { variantId: l.variantId, productId: c.productId, unitPrice: c.price, quantity: l.quantity };
    });
    const now = new Date();
    const evaluate = (shippingPrice: number | null) =>
      promo.evaluate({
        lines,
        email: p.email,
        ...verified,
        shipping: shippingPrice,
        codes: p.codes,
        candidates,
        gifts,
        giftChoices: p.giftChoices,
        now,
      });

    const first = evaluate(null);
    const destination = p.destination;
    if (!destination) return { evaluation: first, evaluatedAt: now, option: null, catalog, gifts };

    const quoteFor = async (e: PromotionEvaluation): Promise<ShippingOption> => {
      const option = await shipping().findOption(
        {
          country: destination.country,
          postalCode: destination.postalCode,
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
        },
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
  const giftOptionsOf = (priced: PricedCart): QuoteGiftOption[] => {
    const out: QuoteGiftOption[] = [];
    for (const promotion of priced.evaluation.applied) {
      for (const benefit of promotion.benefits) {
        const params = benefit.params;
        if (params.type !== 'BUY_X_GET_Y' || params.get.mode !== 'GIFT') continue;
        const quantity = params.get.quantity;
        const line = priced.evaluation.lines.find(
          (l) =>
            l.isGift &&
            l.refs.some((r) => r.promotionId === promotion.promotionId && r.benefitIndex === benefit.index)
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
          variants,
        });
      }
    }
    return out;
  };

  /** A cart priced with its promotions, without writing anything (plan 7's entry point). */
  const quote = async (input: OrderQuoteInput): Promise<OrderQuote> => {
    const errors: ValidationIssue[] = [];
    const locale = clean(input?.locale);
    if (!locale) errors.push({ path: 'locale', code: 'required' });
    const lines = normalizeLines(input?.lines, errors);
    const { promotionCodes, giftChoices } = normalizePromotionFields(input, errors);
    const email = clean(input?.email) || null;
    const emailVerified = typeof input?.emailVerified === 'boolean' ? input.emailVerified : undefined;
    if (email && !isValidEmailFormat(email)) errors.push({ path: 'email', code: 'invalid_email' });

    let destination: PricingDestination | null = null;
    if (input?.shipping) {
      const country = clean(input.shipping.country).toUpperCase();
      const providerId = clean(input.shipping.providerId);
      const serviceId = clean(input.shipping.serviceId);
      const postalCode = clean(input.shipping.postalCode);
      if (!providerId || !serviceId) errors.push({ path: 'shipping', code: 'required' });
      if (!country) {
        errors.push({ path: 'shipping.country', code: 'required' });
      } else {
        const store = await getStoreSettings();
        const countries: string[] = store?.markets ?? [];
        if (!/^[A-Z]{2}$/.test(country) || !countries.includes(country)) {
          errors.push({ path: 'shipping.country', code: 'invalid_country' });
        }
      }
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
    });
    const e = priced.evaluation;
    await assertPricedStock(lines, e.lines);

    return {
      lines: e.lines.map((l) => {
        const c = priced.catalog.get(l.variantId);
        return {
          ...l,
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
        orderDiscount: e.orderDiscount,
        shippingOriginal: e.shippingOriginal,
        shippingDiscount: e.shippingDiscount,
        shippingTotal: e.shippingOriginal === null ? null : e.shippingOriginal - e.shippingDiscount,
        total: e.total,
        totalDiscount: e.totalDiscount,
      },
      shippingOption: priced.option,
      exhaustive: e.exhaustive,
      giftOptions: giftOptionsOf(priced),
    };
  };

  return { priceCart, quote, assertLinesAvailable, assertPricedStock, assertCodesUsable };
};

export type OrderPricing = ReturnType<typeof createOrderPricing>;
