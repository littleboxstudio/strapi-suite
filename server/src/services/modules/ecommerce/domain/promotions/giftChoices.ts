/**
 * Gift choices: which variant a customer (or the admin) wants as the gift of a Buy X Get Y. A
 * promotion has at most one GIFT benefit (definition rule), so choices are keyed by promotion id.
 * A choice is one variant for every gift the promotion gives, or a list with one variant per gift
 * (first gift, second gift, ...). A choice is only a wish: the engine uses it when the variant is
 * one the promotion offers, is active and has stock, and falls back to the default otherwise.
 */

export type GiftChoice = number | number[];
export type GiftChoices = Record<number, GiftChoice>;

/** At most this many variants in a per-gift list (a promotion repeated more times uses the default). */
export const MAX_GIFT_CHOICE_ITEMS = 20;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** A choice as sent (a positive integer id, or a non-empty list of them), else null (invalid). */
export function parseGiftChoice(value: unknown): GiftChoice | null {
  if (isId(value)) return value;
  if (Array.isArray(value) && value.length >= 1 && value.length <= MAX_GIFT_CHOICE_ITEMS && value.every(isId)) {
    return [...value];
  }
  return null;
}

/** The variant wished for gift number `repetition` (0-based), if any. */
export function giftChoiceAt(choice: GiftChoice | undefined, repetition: number): number | undefined {
  if (choice === undefined) return undefined;
  return Array.isArray(choice) ? choice[repetition] : choice;
}
