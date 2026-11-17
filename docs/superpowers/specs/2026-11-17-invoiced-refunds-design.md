# Refunds of invoiced value, with their credit note — design

Status: approved by the store owner (2026-11-17).

## Why

A shop sometimes gives money back without any return. Examples: shipping that should not have
been charged, a product lost in transit, a goodwill gesture. Today the Refund action only gives
back an excess, meaning money paid above the order total. When the customer paid exactly the total,
there is no way to refund, and no credit note documents it.

## Rules (store owner)

- **The button:** the same **Refund** action. It is available as soon as the order has at least
  one invoice, even with no excess.
- **The fields:** method (MANUAL_TRANSFER, STRIPE, STORE_CREDIT), amount, reason and description,
  as today.
- **Two scopes:**
  - `EXCESS` (today's refund): up to the excess. It does not change the order total.
  - `INVOICED` (new): up to the **invoiced value not yet credited**. It **lowers the order total**
    by its amount, so the order stays paid. No new order field: the amount taken off the total is
    derived from the refunds themselves (Σ of the order's INVOICED refunds that count — COMPLETED,
    PROCESSING, PENDING), subtracted after discounts, never below 0.
  - When both are possible, the admin chooses. When there is no excess, the scope is `INVOICED`.
- **Credit note (Moloni active only):** an `INVOICED` refund without a credit note offers
  **Credit note**.
  - The modal lists, per invoice, its **invoiced and not yet credited** elements: product lines
    by whole units, valued at what was effectively paid (the same unit share rule as RETURN
    credit notes), and whole shipping lines.
  - The admin picks elements whose total equals **exactly** the refund amount.
  - **One** credit note is issued, even across several invoices. Moloni accepts this: tested with
    a draft associated to X/6 and X/7. Each line references its invoice and line.
- **After the credit note:** the refund cannot be removed, and a **PDF** button downloads the
  credit note.
- **Remove:** shown only when all of these hold:
  - the refund is `INVOICED`;
  - it has no credit note;
  - the order is not archived;
  - the method is not STRIPE (that money really left);
  - for STORE_CREDIT, the credit is unused (removing it voids the credit).

  Removing it (status CANCELLED) gives the amount back to the total, and writes a history entry. A removed refund
  leaves the list; it is kept as CANCELLED with `metadata.removed`.
- **Moloni not active:** only Remove is shown.

## Data

- **No order field:** `computeTotals` takes `creditAdjustment`, derived from the order's refunds
  (scope INVOICED, counting statuses). Removing a refund (CANCELLED) gives it back by itself.
- **Refund:**
  - `scope` (`EXCESS` | `INVOICED`, default `EXCESS`);
  - `metadata.creditNoteId` once its credit note exists.
- **Credit note:**
  - `metadata.creditType: 'REFUND'`, `metadata.refundId`;
  - each `creditedLines` entry gains `invoiceId`. Old entries default to `creditedInvoice`.
  - `creditedInvoice` stays the first invoice, for old readers.

  Every place that reads credits attributes each entry to its own invoice:
  - the invoicing position;
  - `creditOptions`;
  - `invoiceItems`;
  - the creditable amounts.
- **A REFUND credit note credits value, not units of the order.** Its units never become
  invoiceable again, because the units stay in the order. They do count as credited, so the same
  value is never credited twice.

## Out of scope

Existing EXCESS refunds, returns and the existing credit-note types are unchanged.

## Amendment (2026-11-17): the INVOICED amount is the sum of chosen elements

Store owner decision (option a): an `INVOICED` refund is not a free amount. The admin picks
invoiced, not yet credited elements — product lines by whole units, whole shipping lines — and
the refund amount **is** their sum. So its credit note always matches to the cent.

- **Create (`scope: 'INVOICED'`):** takes `items: [{ invoiceId, index, quantity }]` (required).
  - The server values each item with the same rule as the refund credit note (unit share rule
    for products, whole shipping lines) and stores
    `metadata.items: [{ invoiceId, index, quantity, value }]`.
  - The refund amount is Σ value. A client `amount` that differs is refused
    (`REFUND_AMOUNT_DIFFERS`, 409).
  - Empty items, an unknown element, a DISCOUNT record, partial shipping or more units than
    available are refused (`REFUND_ITEMS_INVALID`, 409, `items.N` details).
- **Reservation:** the elements of an active INVOICED refund (status COMPLETED, PROCESSING,
  PENDING) **without** a credit note are reserved. Other refunds cannot pick them, and the
  available value of a line is its value left minus the reserved values.
  `invoicedRefundable` is the Σ of the available values.
- **Preview:** the refund preview lists the available elements per invoice (the same shape as
  the credit-note options), so the modal can offer them.
- **Credit note:** the modal starts from the refund's own elements.
  - Issuing exactly those elements uses their stored values. No re-valuation, so the total
    always equals the refund.
  - If an element is no longer creditable (for example, a return credit note took it), the
    admin may pick another set whose total equals the refund, as before.
- **Returns:** units in the elements of an active INVOICED refund, with or without a credit note,
  cannot be returned (`UNITS_REFUND_CREDITED`). Each refund counts its units once: its credit note
  entries if it has one, otherwise its items.
- **Legacy:** an INVOICED refund without `metadata.items` reserves by amount (as before).
- **Admin:** the refund modal with the INVOICED scope shows one table per invoice, with whole
  units for products and a checkbox for shipping. The amount is read-only and equals the
  selection. A goodwill amount that matches no element is not an INVOICED refund.
