import type { StoredCart } from '../../storefrontSessions';
import { MAX_CART_LINES, MAX_PROMOTION_CODES } from '../storefront/limits';

const validLine = (l: unknown): l is { variantId: number; quantity: number } =>
  !!l &&
  typeof l === 'object' &&
  Number.isInteger((l as { variantId?: unknown }).variantId) &&
  Number.isInteger((l as { quantity?: unknown }).quantity) &&
  (l as { quantity: number }).quantity > 0;

/**
 * The cart a customer gets when logging in with a guest cart: quantities of the same variant add
 * up (capped), codes are united, and the guest's destination, shipping method, gift choices and
 * locale win when set. The e-mail is always null (the account's e-mail is used).
 */
export const mergeCarts = (
  account: StoredCart,
  guest: StoredCart,
  maxQuantityPerLine: number
): StoredCart => {
  const lines: StoredCart['lines'] = [];
  for (const l of [...account.lines, ...guest.lines]) {
    if (!validLine(l)) continue;
    const same = lines.find((x) => x.variantId === l.variantId);
    if (same) same.quantity = Math.min(same.quantity + l.quantity, maxQuantityPerLine);
    else lines.push({ variantId: l.variantId, quantity: Math.min(l.quantity, maxQuantityPerLine) });
  }
  const promotionCodes = [...new Set([...account.promotionCodes, ...guest.promotionCodes])];
  return {
    lines: lines.slice(0, MAX_CART_LINES),
    promotionCodes: promotionCodes.slice(0, MAX_PROMOTION_CODES),
    giftChoices: Object.keys(guest.giftChoices).length ? guest.giftChoices : account.giftChoices,
    email: null,
    destination: guest.destination ?? account.destination,
    shippingMethod: guest.shippingMethod ?? account.shippingMethod,
    locale: guest.locale ?? account.locale,
  };
};
