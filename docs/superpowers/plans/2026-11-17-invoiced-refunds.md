# Invoiced Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refund invoiced value without a return, lowering the order total, with an optional
credit note (Moloni) built from invoiced elements across several invoices, plus Remove and PDF.

**Architecture:**
- The total is lowered by a derived `creditAdjustment`: Σ of the order's INVOICED refunds that
  count (COMPLETED, PROCESSING, PENDING). No order field stores it.
- Refunds gain a `scope` (EXCESS | INVOICED).
- Credit notes record per-line `invoiceId`, so one note can credit several invoices.
- A REFUND credit-note type credits value and never frees units for invoicing.

**Tech Stack:** TypeScript, Strapi 5 plugin, React admin with @strapi/design-system, vitest.
Money is integer cents with VAT included.

**Spec:** `docs/superpowers/specs/2026-11-17-invoiced-refunds-design.md`

## Global Constraints

- Repo `/Users/filipemoraes/Projects/littlebox-plugins/strapi/suite`, branch `feat/ecommerce`.
- **Commits:**
  - Commit with explicit paths, never `git add -A`; never touch `.yalc/` or `yalc.lock`.
  - End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - After each commit, run `git branch -f main HEAD`. No push.
- Modules outside e-commerce must not change.
- **Checks:**
  - `npx tsc -p {server,admin,tests}/tsconfig.json --noEmit`;
  - `npx vitest run` (3844 passing before this plan).
- Never print customer data, credentials or tokens. Never call the real Moloni API from tests.
- Admin texts go in `admin/src/core/translations/{en,pt}.json` (prefix `littlebox-strapi-suite.`).
  Portuguese uses correct accents.
- Every total reconciles to the cent. Credit notes are only issued by the admin.

## Review Focus

1. An INVOICED refund on an order whose invoices were partly credited by RETURN: the maximum
   excludes already-credited value. Test in Task 2.
2. A REFUND credit note never makes units invoiceable again, nor creditable twice. Test in Task 3.
3. A credit note across two invoices: each line's `invoiceId`, Moloni `associated_documents` with
   one entry per invoice and its value, and `related_id` per line. Test in Task 4.
4. Removing a STORE_CREDIT INVOICED refund whose credit was used is refused; an unused one is
   voided. Test in Task 2.
5. An archived order offers neither Remove nor Credit note. Test in Tasks 2 and 5.

---

### Task 1: a derived `creditAdjustment` in the totals

**Files:**
- No order field: the order content-type is unchanged.
- `domain/refunds.ts`: `invoicedRefundAdjustment(refunds)` = Σ amount of the refunds with scope
  INVOICED and status COMPLETED, PROCESSING or PENDING. A FAILED or CANCELLED (removed) refund
  gives its amount back by itself.
- `domain/orders.ts` `computeTotals`: an optional `creditAdjustment` on the order arg, subtracted
  last (after discounts); the total is never below 0.
- Every caller that persists totals passes `invoicedRefundAdjustment(state.refunds)` (find them
  with grep).
- Order view `totals` exposes `creditAdjustment`.
- Tests: `tests/server/ecommerce/domain/orders.test.ts`, `domain/refunds.test.ts` plus an
  integration test.

**Interfaces:**
- `computeTotals(lines, { orderDiscount, shippingOriginal, shippingDiscount, creditAdjustment? })`
  returns `OrderTotals` with `creditAdjustment`.
- **Test:** lines 5000, shipping 490, adjustment 490 → total 5000.
- **Test:** no adjustment → unchanged.
- **Test:** only INVOICED refunds in a counting status add to the adjustment.

- [ ] Write the failing tests, implement them, run the suite, commit
  `feat(ecommerce): order creditAdjustment lowers the total`.

### Task 2: INVOICED refunds (create, limits, remove)

**Files:**
- Refund content-type: add `scope` (enumeration EXCESS, INVOICED; default EXCESS).
- `server/src/services/modules/ecommerce/refunds.ts`.
- Its controller and routes. Add `POST /refunds/:id/remove`, behind `refundsManage`.
- `domain/refunds.ts` as needed.
- The order action gate: REFUND is offered when there is an excess **or** an invoiced refundable
  amount above 0.
- Tests: `tests/server/ecommerce/refunds*.test.ts`.

**Rules:**
- `invoicedRefundable` = Σ over counted, non-annulled invoices of their creditable value (reuse
  `creditOptions`), minus the amounts of active INVOICED refunds that have no credit note yet.
- **Preview** returns `excess` (today's `refundable`), `invoicedRefundable` and the
  `moneyRefundable` / `stripeRefundable` limits per scope.
- **Create with `scope: 'INVOICED'`:**
  - amount ≤ `invoiceRefundable`;
  - otherwise the same methods and emails as today;
  - in the same transaction, the totals and payment status are recomputed: the new refund counts
    in the derived `creditAdjustment` (nothing is stored on the order);
  - history entry `REFUND_CREATED` as today.
  - `scope` defaults to EXCESS when absent.
- **Remove:** allowed when all of these hold:
  - scope INVOICED;
  - no `metadata.creditNoteId`;
  - order not ARCHIVED;
  - method not STRIPE;
  - for STORE_CREDIT, the credit is unused (then void it via the store credit service).

  Then:
  - status CANCELLED and `metadata.removed`;
  - totals recomputed: a CANCELLED refund no longer counts in the derived `creditAdjustment`;
  - history `REFUND_REMOVED`.

  The refund list excludes removed refunds. Error codes:
  - `REFUND_NOT_REMOVABLE`
  - `REFUND_HAS_CREDIT_NOTE`
  - `STORE_CREDIT_USED`
- **Tests:**
  - create INVOICED on a paid order: the total drops, the order stays PAID, `refunded` grows;
  - the limit excludes RETURN-credited value;
  - remove restores the total;
  - remove is refused when STRIPE, ARCHIVED, a credit note exists, or the store credit was used.

- [ ] Write the failing tests, implement, run, commit
  `feat(ecommerce): refunds of invoiced value lower the order total; remove`.

### Task 3: Credit notes credit several invoices (data and position)

**Files:**
- `domain/invoiceSelection.ts`: `readInvoiceDoc` reads `invoiceId` per `creditedLines` entry,
  defaulting to `creditedInvoiceId`.
- `domain/creditNotes.ts`.
- `domain/invoiceItems.ts`.
- `invoices.ts`.

**Rules:**
- Every computation of credited value or units uses each entry's own `invoiceId`.
- New `creditType` `'REFUND'`:
  - its entries reduce the creditable value of their invoice lines;
  - they never add to the units that free invoicing, because the units stay in the order;
  - a `CORRECTION` of an invoice still annuls only that invoice.
- **Tests:**
  - a REFUND credit note with entries on invoices A and B lowers both invoices' creditable values;
  - `invoiceItems` still shows those lines as invoiced;
  - old single-invoice credit notes read exactly as before (the existing suite stays green).

- [ ] Write the failing tests, implement, run, commit
  `feat(ecommerce): credit notes record their invoice per line (multi-invoice)`.

### Task 4: Credit note for an INVOICED refund (service and Moloni)

**Files:**
- `invoices.ts`: `refundCreditNoteOptions(refundId)` and `issueRefundCreditNote(refundId, input)`.
- Controller and routes:
  - `GET /refunds/:id/credit-note/options`
  - `POST /refunds/:id/credit-note`

  Both behind `invoicingManage` (read: `ordersRead`).
- Moloni provider: the draft can carry several originals. `associated_documents` gets one entry
  per invoice with its value, and each product's `related_id` points to its own original's line.
  Reuse and extend `relateToOriginal`.

**Interfaces:**
- **Options:** `{ refund: { id, amount }, invoices: [{ invoiceId, number, lines: [{ index, kind, name, quantityLeft, unitValue, valueLeft }] }] }`.
  - ITEM lines offer `quantityLeft` units, valued by the RETURN share rule (`sharedUnitsCredit`).
  - SHIPPING lines are whole (`quantityLeft` 1, `valueLeft`).
  - DISCOUNT records are never listed.
- **Issue:** `{ items: [{ invoiceId, index, quantity }], idempotencyKey }`.
  - Σ values must equal the refund amount, else `CREDIT_TOTAL_DIFFERS`.
  - Refused when the refund is not INVOICED, already has a credit note, Moloni is not active, or
    the order is archived.
  - Creates one CREDIT_NOTE row:
    - `creditedInvoice` = the first invoice;
    - `metadata` `{ creditType: 'REFUND', refundId, creditedLines: [{ invoiceId, index, value, quantity }] }`.
  - Sets the refund's `metadata.creditNoteId`.
  - Uses the same pending, issued and uncertain handling as `issueCreditNote`.
- **Tests:**
  - options list only invoiced, not yet credited elements;
  - issuing across two invoices stores per-line `invoiceId`;
  - the Moloni fake receives two `associated_documents` and per-line `related_id`;
  - the wrong total is refused.

- [ ] Write the failing tests, implement, run, commit
  `feat(ecommerce): credit note for an invoiced refund, across invoices`.

### Task 5: Admin

**Files:**
- `RefundModal.tsx`: the scope choice, shown only when both scopes are possible, with each scope's
  limit.
- `RefundsTable.tsx`, per INVOICED refund:
  - **Credit note** (Moloni active, none yet, order not archived);
  - **PDF** (once the credit note exists; reuse the invoice PDF endpoint);
  - **Remove** (rules as in Task 2, with a confirmation).
- New `RefundCreditNoteModal.tsx`:
  - one table per invoice, with a title "Fatura X/N" in sigma uppercase;
  - columns Product/Shipping, Qty left, Unit value, Quantity to credit (whole units; shipping as a
    checkbox), Value;
  - totals: Selected, Refund, Difference;
  - Issue is enabled only when the difference is 0, with a confirmation.
- Gateway, use cases and types to match.
- Order view flags:
  - `billingActive` (whether the Moloni / billing provider is active);
  - per refund: `scope`, `creditNoteId`, `removable`.
- Translations.
- Tests: helpers for the modal totals and the per-refund actions.

- [ ] Write the failing tests, implement, run, commit
  `feat(ecommerce): admin — invoiced refunds, their credit note, PDF and remove`.

### Task 6 (controller): checks, sync, browser check

- [ ] Full checks.
- [ ] Rsync to `backend-base` and restart.
- [ ] Browser: on an invoiced order, open Refund and see the INVOICED scope and limit. Close
  without creating anything.

---

## Amendment tasks (spec "Amendment: the INVOICED amount is the sum of chosen elements")

### Task 7: server — INVOICED refunds are built from elements

**Files:**
- `refunds.ts`: create, preview, reservation.
- `invoices.ts`: refund credit-note options and issue.
- `returns.ts`, `domain/invoiceSelection.ts`, `domain/creditNotes.ts`, `domain/refunds.ts`.
- `controllers/.../errors.ts`: `REFUND_AMOUNT_DIFFERS` and `REFUND_ITEMS_INVALID` → 409.

**Rules:** as in the spec amendment. The valuation is one shared function (the one the refund
credit-note options already use). Available elements =
creditOptions − reservations of other active refunds without a credit note.

**Tests:**
- create INVOICED from items stores `metadata.items` with values, and its amount = Σ;
- a client amount that differs → `REFUND_AMOUNT_DIFFERS`;
- invalid items → `REFUND_ITEMS_INVALID`;
- a second refund cannot reserve the same units, and `invoicedRefundable` drops;
- the preview lists the available elements;
- the credit note with the stored items equals the refund to the cent, even when the line's
  remainder cent sits with another refund's units (3 units, value 1000);
- a fallback reselection still works;
- a return of reserved units → `UNITS_REFUND_CREDITED`;
- a legacy refund without items reserves by amount.

- [ ] TDD, run the suite, commit
  `feat(ecommerce): an invoiced refund is the sum of chosen invoiced elements`.

### Task 8: admin — pick the elements in the refund modal

**Files:**
- `RefundModal.tsx`: with the INVOICED scope, one table per invoice under a sigma title. Whole
  units for products, a checkbox for shipping. The amount is read-only = Σ, and it is sent as
  `items` + `amount`.
- `RefundCreditNoteModal.tsx`: prefilled with the refund's `items`, which are fixed by default;
  another selection is allowed only when the server says an element is unavailable.
- Helpers in `utils/` with tests; translations en/pt.

- [ ] TDD, run the suite, commit
  `feat(ecommerce): admin — an invoiced refund picks its elements`.
