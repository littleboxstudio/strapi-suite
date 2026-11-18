/**
 * Pure helpers shared by `orders.ts` and `orderPricing.ts`. Leaf module: it must never import
 * either of them (no import cycle).
 */
import type { ValidationIssue } from './errors';
import type { PromotionEvaluation } from './domain/promotions';

import { MAX_PROMOTION_CODES } from './domain/storefront/limits';
import { readDiscountPercent } from './domain/lineDiscounts';
import { parseGiftChoice, type GiftChoices } from './domain/promotions/giftChoices';

export { MAX_PROMOTION_CODES };

export type CatalogVariant = {
  variantId: number;
  productId: number;
  sku: string;
  price: number;
  tax: number;
  weight: number;
  width: number;
  height: number;
  depth: number;
  name: string;
  option: string | null;
  imageUrl: string | null;
  stock: number;
  /** The variant and its product are both active. */
  active: boolean;
};

/** `discountPercent`: the admin's manual line discount (spec 4.1), only when one is set. */
export type MergedLine = {
  index: number;
  variantId: number;
  quantity: number;
  discountPercent?: number;
};

export const isRecord = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Units per variant, in first-appearance order. */
export const quantitiesByVariant = (lines: { variantId: number; quantity: number }[]) => {
  const out = new Map<number, number>();
  for (const l of lines) out.set(l.variantId, (out.get(l.variantId) ?? 0) + l.quantity);
  return out;
};

/**
 * The `quoteForLines` input (with `fromQuote`) that prices the shipping options as an order
 * quote, and `create`, price the shipping: the quote's lines with the promotion's gifts flagged
 * (they weigh, they add nothing) and its products subtotal after the promotions' order discount.
 * The manual order discounts come after the shipping is priced, so they are left out.
 */
export const shippingInputOfQuote = (quote: {
  lines: { variantId: number; quantity: number; isGift?: boolean }[];
  totals: { subtotal: number; orderDiscount: number };
  manualDiscounts?: { amount: number }[];
}): { lines: { variantId: number; quantity: number; gift?: true }[]; subtotal: number } => {
  const manual = (quote.manualDiscounts ?? []).reduce((sum, m) => sum + m.amount, 0);
  return {
    lines: quote.lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      ...(l.isGift ? { gift: true as const } : {}),
    })),
    subtotal: quote.totals.subtotal - (quote.totals.orderDiscount - manual),
  };
};

/** The gift units of an evaluation per variant, as a comparable string. */
export const giftSignature = (e: PromotionEvaluation): string =>
  JSON.stringify(
    [...quantitiesByVariant(e.lines.filter((l) => l.isGift)).entries()].sort((a, b) => a[0] - b[0])
  );

/**
 * Order lines with repeated variants summed into the first occurrence. With `discounts` (admin
 * only, spec 4.1) each line may carry `discountPercent`; repeated variants must agree on it.
 * Without it the field is ignored (storefront: unknown fields are ignored).
 */
export function normalizeLines(
  raw: unknown,
  errors: ValidationIssue[],
  options: { discounts?: boolean } = {}
): MergedLine[] {
  const rawLines: any[] = Array.isArray(raw) ? raw : [];
  if (!rawLines.length) errors.push({ path: 'lines', code: 'required' });
  const merged = new Map<number, MergedLine>();
  rawLines.forEach((l, i) => {
    const variantId = Number(l?.variantId);
    const quantity = l?.quantity;
    if (!Number.isSafeInteger(variantId) || variantId <= 0) {
      errors.push({ path: `lines.${i}.variantId`, code: 'required' });
      return;
    }
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
      errors.push({ path: `lines.${i}.quantity`, code: 'INVALID_QUANTITY' });
      return;
    }
    let discountPercent: number | null = null;
    if (options.discounts) {
      const parsed = readDiscountPercent(l?.discountPercent);
      if (!parsed.ok) {
        errors.push({ path: `lines.${i}.discountPercent`, code: 'INVALID_PERCENT' });
        return;
      }
      discountPercent = parsed.value;
    }
    const prev = merged.get(variantId);
    if (prev) {
      if ((prev.discountPercent ?? null) !== discountPercent) {
        errors.push({ path: `lines.${i}.discountPercent`, code: 'INVALID_PERCENT' });
        return;
      }
      prev.quantity += quantity;
    } else {
      merged.set(variantId, {
        index: i,
        variantId,
        quantity,
        ...(discountPercent !== null ? { discountPercent } : {}),
      });
    }
  });
  return [...merged.values()];
}

/**
 * `promotionCodes` (strings, at most MAX_PROMOTION_CODES, kept in order so errors point at the
 * entered index) and `giftChoices` (positive promotion ids → a variant id, or one per gift).
 */
export function normalizePromotionFields(
  input: { promotionCodes?: unknown; giftChoices?: unknown } | undefined,
  errors: ValidationIssue[]
): { promotionCodes: string[]; giftChoices: GiftChoices } {
  const rawCodes = input?.promotionCodes;
  let promotionCodes: string[] = [];
  if (rawCodes !== undefined && rawCodes !== null) {
    if (!Array.isArray(rawCodes)) {
      errors.push({ path: 'promotionCodes', code: 'invalid' });
    } else if (rawCodes.length > MAX_PROMOTION_CODES) {
      errors.push({ path: 'promotionCodes', code: 'too_many' });
    } else {
      rawCodes.forEach((code, i) => {
        if (typeof code !== 'string') errors.push({ path: `promotionCodes.${i}`, code: 'invalid' });
      });
      promotionCodes = rawCodes.map((code) => (typeof code === 'string' ? code : ''));
    }
  }

  const rawChoices = input?.giftChoices;
  const giftChoices: GiftChoices = {};
  if (rawChoices !== undefined && rawChoices !== null) {
    if (!isRecord(rawChoices)) {
      errors.push({ path: 'giftChoices', code: 'invalid' });
    } else {
      for (const [key, value] of Object.entries(rawChoices)) {
        const promotionId = Number(key);
        const choice = parseGiftChoice(value);
        if (!Number.isSafeInteger(promotionId) || promotionId <= 0 || choice === null) {
          errors.push({ path: `giftChoices.${key}`, code: 'invalid' });
        } else {
          giftChoices[promotionId] = choice;
        }
      }
    }
  }
  return { promotionCodes, giftChoices };
}

/** At most this many selected automatic promotions (`promotionIds`, admin Create order). */
export const MAX_PROMOTION_IDS = 50;

/**
 * `promotionIds` (admin only): the automatic promotions to evaluate. Absent or null → undefined
 * (every running automatic promotion, as before); otherwise distinct positive integer ids, in
 * order. An empty list evaluates no automatic promotion.
 */
export function normalizePromotionIds(raw: unknown, errors: ValidationIssue[]): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    errors.push({ path: 'promotionIds', code: 'invalid' });
    return undefined;
  }
  if (raw.length > MAX_PROMOTION_IDS) {
    errors.push({ path: 'promotionIds', code: 'too_many' });
    return undefined;
  }
  const ids: number[] = [];
  raw.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
      errors.push({ path: `promotionIds.${i}`, code: 'invalid' });
    } else if (!ids.includes(v)) {
      ids.push(v);
    }
  });
  return ids;
}

/** At most this many shipping charges entered on Create order. */
export const MAX_CREATE_SHIPPING_LINES = 10;

/** A shipping charge entered on Create order (admin): the method and its amount (cents, VAT incl.). */
export type ShippingLineInput = {
  providerId: string;
  serviceId: string;
  amount: number;
  pickupPointId?: string | null;
  pickupPostalCode?: string | null;
};

/**
 * `shippingLines` (admin Create order): 1 to MAX_CREATE_SHIPPING_LINES entries, each with a
 * method (`shippingLines.<i>` required) and an amount in whole cents in [0, MAX_MONEY_CENTS]
 * (`shippingLines.<i>.amount` INVALID_AMOUNT). The pickup fields are kept as given (the first
 * entry's are checked by the pickup resolution, as the single `shipping`'s are).
 */
export function normalizeShippingLines(
  raw: unknown,
  errors: ValidationIssue[],
  maxAmount: number
): ShippingLineInput[] {
  if (!Array.isArray(raw)) {
    errors.push({ path: 'shippingLines', code: 'invalid' });
    return [];
  }
  if (!raw.length) {
    errors.push({ path: 'shippingLines', code: 'required' });
    return [];
  }
  if (raw.length > MAX_CREATE_SHIPPING_LINES) {
    errors.push({ path: 'shippingLines', code: 'too_many' });
    return [];
  }
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const out: ShippingLineInput[] = [];
  raw.forEach((entry, i) => {
    const e = isRecord(entry) ? entry : {};
    const providerId = text(e.providerId);
    const serviceId = text(e.serviceId);
    const amount = e.amount;
    let ok = true;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > maxAmount) {
      errors.push({ path: `shippingLines.${i}.amount`, code: 'INVALID_AMOUNT' });
      ok = false;
    }
    if (!providerId || !serviceId) {
      errors.push({ path: `shippingLines.${i}`, code: 'required' });
      ok = false;
    }
    if (!ok) return;
    out.push({
      providerId,
      serviceId,
      amount: amount as number,
      ...(e.pickupPointId !== undefined ? { pickupPointId: e.pickupPointId } : {}),
      ...(e.pickupPostalCode !== undefined ? { pickupPostalCode: e.pickupPostalCode } : {}),
    });
  });
  return out;
}
