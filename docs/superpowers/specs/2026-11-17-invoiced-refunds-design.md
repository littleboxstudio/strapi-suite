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
    by its amount, so the order stays paid. It is stored on a new order field `creditAdjustment`
    (cents ≥ 0, subtracted from the total after discounts, never below 0).
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

  Removing it gives the `creditAdjustment` back, and writes a history entry. A removed refund
  leaves the list; it is kept as CANCELLED with `metadata.removed`.
- **Moloni not active:** only Remove is shown.

## Data

- **`order.creditAdjustment`** (integer, default 0) is the sum of the active `INVOICED` refunds.
  `computeTotals` takes it.
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
