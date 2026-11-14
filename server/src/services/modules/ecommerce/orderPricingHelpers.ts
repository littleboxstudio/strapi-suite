/**
 * Pure helpers shared by `orders.ts` and `orderPricing.ts`. Leaf module: it must never import
 * either of them (no import cycle).
 */
import type { ValidationIssue } from './errors';
import type { PromotionEvaluation } from './domain/promotions';

import { MAX_PROMOTION_CODES } from './domain/storefront/limits';
import { readDiscountPercent } from './domain/lineDiscounts';

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
 * entered index) and `giftChoices` (positive integer ids on both sides).
 */
export function normalizePromotionFields(
  input: { promotionCodes?: unknown; giftChoices?: unknown } | undefined,
  errors: ValidationIssue[]
): { promotionCodes: string[]; giftChoices: Record<number, number> } {
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
  const giftChoices: Record<number, number> = {};
  if (rawChoices !== undefined && rawChoices !== null) {
    if (!isRecord(rawChoices)) {
      errors.push({ path: 'giftChoices', code: 'invalid' });
    } else {
      for (const [key, value] of Object.entries(rawChoices)) {
        const promotionId = Number(key);
        const variantId = Number(value);
        if (
          !Number.isSafeInteger(promotionId) ||
          promotionId <= 0 ||
          typeof value !== 'number' ||
          !Number.isSafeInteger(variantId) ||
          variantId <= 0
        ) {
          errors.push({ path: `giftChoices.${key}`, code: 'invalid' });
        } else {
          giftChoices[promotionId] = variantId;
        }
      }
    }
  }
  return { promotionCodes, giftChoices };
}
