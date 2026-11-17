# Duplicate an order; Create order redesign — design

Status: approved by the store owner (2026-11-17, answers in chat).

## Why
The admin often re-creates an order for the same customer with the same products, for example
an order to replace another, or a test order. Today every field must be typed again.

## Rules (store owner)
- **Button.** A **Duplicate** button at the top of the order detail, in the header actions, with
  `secondary` style. It is available for any order status and needs the orders.manage permission.
  It opens **Create order** pre-filled with:
  - the customer (first name, last name, e-mail, phone);
  - the shipping address and the billing address;
  - the locale;
  - the products: each non-gift line with `variantId` and `quantity − returnedQuantity`. Lines with
    0 left are skipped. A line's manual percent discount is kept (`discountPercent`).
  - the promotion codes that were applied, re-validated by the quote;
  - the gift choices: per GIFT promotion, the variant that was chosen, if it is still offered;
  - the **order-level manual discounts** (FIXED amount or PERCENT, each with its reason). LEGACY
    ones are copied as FIXED with their amount.
  - the shipping method: the same provider and service, and the same pickup point or store when
    there was one, if the quote still offers them.
- **Prices.** Current prices and promotions (owner's choice). Product prices, automatic
  promotions, gifts and the shipping price are recalculated by the quote, as for a new order.
  Nothing is copied from the old totals.
- **What is not copied:** payments, invoices, shipments, returns, refunds, notes, history and
  review flags.
- **Products that no longer exist or are out of stock:** the variant picker and the quote already
  handle them. A line whose variant no longer exists is dropped, and a NoticeBar lists the dropped
  products by name.

## Create order: manual discounts (new)
- Create order gains a **Promotions and discounts** section that looks like the order detail's:
  - the applied promotions table from the quote;
  - the manual discounts with **Add discount** (FIXED or PERCENT, plus a reason) and remove;
  - the total discount.
- **Server.** `CreateOrderInput` gains `manualDiscounts?: [{ kind: 'FIXED' | 'PERCENT', value, reason }]`,
  using the same validation and the same `buildManualDiscount` rules as the order's
  `addManualDiscount`. Their base is the subtotal after promotions, and the quote applies them.
  - The order is created with them, so the total and `expectedTotal` match, and their history
    entries are written.
  - The quote endpoint accepts them too, so the preview shows the final total.

## Create order: redesign
One Create order screen, used both to create and to duplicate, redesigned to look like the order
detail page. It uses the same section components and styles where possible:
- **Customer**, **Shipping address** and **Billing address**.
- **Products**: the same table look as the detail's Products section.
- **Shipping**: the same look as the detail's shipping section and its shipping-method choice,
  meaning the MethodsPanel-style list of methods with the price, and the pickup point or store
  picker.
- **Promotions and discounts**: as the detail's PromotionsSection, with promotions, codes, gifts,
  manual discounts, and Add discount.
- **Totals**: the detail's payments-summary tiles style.

The existing create behaviours and validations are unchanged: the idempotency key,
`expectedTotal`, `TOTAL_CHANGED`, the pickup checks, the codes and the gifts.

## Out of scope
Copying payments, notes and invoices.
