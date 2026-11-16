# Invoicing whole items — design

Status: approved by the store owner (2026-11-16). Replaces the value model of
`2026-11-14-invoicing-by-selection-design.md` (pools split by weight). The selection flow stays:
the admin picks what to invoice and the payments, and the totals must match.

## Why

Order 23 showed the pool model inventing prices. Products due minus everything invoiced was
re-split over the remaining units. A removed (but invoiced) line therefore made the next invoice
price 3 units at €15.50 instead of their real value. The store owner's rules are binding:

- An invoice takes **whole items**:
  - a product line, with all its units and its own discount;
  - a shipping line;
  - an order-level discount.

  It never takes a quantity of a line, nor part of a value.
- The admin picks the items and the payments. **The invoice total equals the selected payments,
  to the cent.**
- An item on an invoice is **locked forever**. It is never edited, never removed, and never put on
  another invoice. Taking it back means a refund (plus a return if delivered) and a credit note
  issued by the admin. Credit notes are never automatic.
- Recalculate shipping never removes charges. Recalculate discounts never removes applied
  discounts and never changes invoiced lines. The guards are done (`838c769`, `7063d96`).
- No stray cents anywhere: every amount reconciles exactly.

## Invoiceable items

| Item | Value (cents, VAT included) | Source |
|---|---|---|
| Product line | `(quantity − returned) × (unitPrice − unitDiscount)` | order line |
| Shipping line | `amount` (gross; an EDIT correction goes with its line) | `order.shippingLines` |
| Order discount | its amount, subtracted | each manual discount (FIXED or PERCENT, stored amount), each ORDER promotion benefit |
| Shipping discount | its amount, subtracted | the applied shipping promotion |

The order's `orderDiscount` equals Σ order discount items, and `shippingDiscount` equals Σ shipping
discount items. Both are invariants, checked when written. The pieces that break this today must
be reconciled by the plan:

- recalculation remainders;
- pro-rata return shares;
- the "LEGACY" manual item.

A discount applied to one product (a promotion on that product, a manual line %) belongs to that
line and is identified on that line. Order-level discounts never attach to a line in our data.

## Exact line discounts (no remainders)

Today `recalculateDiscounts` averages a promotion over a line (`floor(D/q)`) and pushes the
remainder into `orderDiscount`. For example, "buy 2 get 1" on 3 units gives 3 × €20.67 plus a
stray cent. Instead it **splits the line the way checkout does**: one line per distinct unit
discount.

- "Buy 2 get 1" on a 3-unit line becomes 2 units at €31.00 and 1 unit at €31.00 − €31.00 (ref to
  the promotion).
- Both lines keep the same variant and the same snapshot (name, tax, product). Stock is unchanged.
- No remainder ever reaches `orderDiscount`.

Order 23 is fixed once by a script, with a backup:

- line 21 is split;
- its 1-cent remainder comes off `orderDiscount`.

## Selection

`GET /orders/:id/invoice-selection` lists what is not yet invoiced: whole product lines, shipping
lines and discount items. It also lists the available payments, net of held refunds.

`POST /orders/:id/invoices` takes
`{ orderLineIds, shippingLineIds, discountIds, paymentIds, expectedTotal, idempotencyKey }`.

- **Total:** Σ lines + Σ shipping − Σ discounts. It must equal Σ payment nets and be greater
  than 0.
- **Discount cap:**
  - An order discount needs selected product lines worth at least its amount.
  - A shipping discount needs selected shipping worth at least its amount.
  - Otherwise the code is `DISCOUNT_EXCEEDS_SELECTION`.
- **Legacy lines:** a line partially invoiced by an old pool invoice offers its remaining units as
  one item, worth units × net unit price.
- **Admin modal:** checkboxes only (lines, shipping, discounts, payments). No quantities.

## The document (Moloni)

This was tested on the test account with draft documents, which were deleted afterwards:

- `special_discount` comes off **after** VAT.
- `financial_discount` is a percentage on every line, shipping included.

Neither fits. An order-level discount must reduce the taxable base of the products before VAT.

The decision (option a, store owner):

- **Spreading.** Each selected discount is spread over the selected lines of its pool
  (`allocateProportionally`, weights = each line's net value, so a free line gets nothing):
  - order discounts over the product lines;
  - the shipping discount over the shipping lines.
- **Line discount sent to Moloni.** Each line is sent with one discount %, combining its own
  discount and its share: `1 − (net − share) / gross`.
- **Line note.** A short note on the line names the parts, for example "Line discount 10% + order
  discount €9.00". It uses the product `summary` field once a draft confirms it.
- **Two-decimal limit.** Where a % with 2 decimals cannot hit the line's cents, only that line falls
  back to the discounted unit price, with no %. The note still explains the discount.
- **Read-back.** The issued total is read back (existing `TOTAL_MISMATCH`).

Our stored invoice keeps:

- each product line with its own discount (`grossTotal`, line total);
- each discount item as its own line of kind `DISCOUNT` (negative, with `discountId`), plus its
  share per line (`discountShare`) for returns.

## Returns of invoiced products

The refund and the RETURN credit note for a unit are what the customer **effectively paid for it**,
VAT included:

- the unit's net value;
- minus its share of the order and shipping discounts on its invoice.

The last returned unit of a line takes the line's remaining share, so the cents add up.

## Locks

- A product line on an invoice keeps its quantity and its discount, and cannot be removed.
- A shipping line on an invoice cannot be edited or removed.
- A discount item on an invoice cannot be removed, and the recalculation never removes promotions.

## Out of scope

Payment coverage per line is unchanged. It only drives `shippable` and the shipping paid flags.
