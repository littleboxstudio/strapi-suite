/**
 * Input bounds of the storefront API, shared by the checkout service and the storefront
 * controller (Task 10), so the quote and order paths can never disagree.
 */

/** Lines in a cart or an order. */
export const MAX_CART_LINES = 100;
/** Units of one line. */
export const MAX_LINE_QUANTITY = 1000;
/** Promotion codes entered on one cart or order. */
export const MAX_PROMOTION_CODES = 5;
/** Length of a promotion code (also the upper bound of a stored code's pattern). */
export const MAX_PROMOTION_CODE_LENGTH = 40;
/** `promotionId → variantId` gift choices. */
export const MAX_CART_GIFT_CHOICES = 10;
/** Client Idempotency-Key: `sf:<sessionId>:<key>:store-credit` stays within the order key cap. */
export const MAX_STOREFRONT_IDEMPOTENCY_KEY_LENGTH = 150;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_POSTAL_CODE_LENGTH = 20;
export const MAX_LOCALE_LENGTH = 35;
/** `providerId` / `serviceId` of a shipping method. */
export const MAX_SHIPPING_ID_LENGTH = 100;
export const MAX_STORE_CREDIT_CODE_LENGTH = 64;
