# Invoicing by Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-payment invoicing and "Gerar fatura total" with one **Gerar fatura** modal. The merchant picks what to invoice (product quantities, positive shipping lines) and which whole payments pay for it, and the invoice is issued only when both totals are equal. Credit notes get a reason, **Devolução** or **Correção**, and a Correção makes the corrected invoice's products, shipping and payments available again.

**Architecture:** Two pure domain modules hold the rules:
- `domain/invoiceSelection.ts`: the invoicing position (what is invoiced, what is left and what it is worth), payment net values, and pricing and validation of a selection;
- `domain/creditNotes.ts`: what an invoice can still credit, by reason.

Both read the stored invoice rows as `InvoiceDoc`s. Legacy (per-payment) rows are read through the same parser (ruling 4), so no stored document changes. `EcommerceOrderService.computeOrderState` computes the position once (`state.invoicing`). `EcommerceInvoiceService` keeps its two-phase issue, UNCERTAIN handling, reconcile, PDF and events. Only composition and validation change. Payment-coverage reconciliation (`reconcileCoverages` and the related functions) is deleted. The Moloni provider resolves one payment method per payment, by name, and creates it when it is missing. The admin replaces `IssueInvoiceModal` and `CreditNoteModal` and drops the per-payment invoice button and badge.

**Tech Stack:** Strapi 5 plugin (TypeScript server, React admin with `@strapi/design-system` v2), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-invoicing-by-selection-design.md` (binding, Portuguese, including §7.1). Where they contradict it, the spec replaces §4.4 and §4.12 of `docs/superpowers/specs/2026-11-11-ecommerce-design.md` and §8 of `docs/superpowers/specs/2026-11-13-order-editing-design.md`. Below, "spec 7.1.3" means rule 3 of §7.1.

## Rulings

These settle what the spec leaves to the builder (decision, then why).

1. **Two value pools (spec 4, 7.1.3).**
   - Products: `due = Σ coverageDues(order).lineDue` (subtotal − clamped order discount); `remaining = max(0, due − netInvoicedProducts)`.
   - Shipping: `due = max(0, shippingTotal)`; `remaining = max(0, due − netInvoicedShipping)`.
   - `netInvoiced` = Σ ITEM (or SHIPPING) totals of the counted invoices − Σ the same totals of the counted RETURN credit notes (ruling 3).
   - Why: §4 splits order discounts over products only and the shipping discount over shipping only. Each pool keeps its VAT lines, and Σ of every part still equals the order total.
2. **Distribution (spec 4, 7.1.3).**
   - Product pool: over lines with `remainingQuantity > 0` with `allocateProportionally(remaining, weights)`, `weight = remainingQuantity × max(0, unitPrice − unitDiscount)`. When all weights are 0, the weight is `remainingQuantity`.
   - Shipping pool: over the **available** shipping lines (amount > 0, not invoiced), weight = amount.
   - Largest remainder, lower index first (the existing `allocateProportionally`).
   - A negative shipping line is never available. It only lowers the pool (it creates excess).
   - Why: deterministic, exact to the cent. On the first invoice the result equals `coverageDues`.
3. **Which documents count.**
   - **Invoices** count while `ISSUED`, `PENDING` or `UNCERTAIN` (prudent: an unknown outcome keeps its units, shipping lines and payments).
   - **Credit notes** reduce what is invoiced (value, units) only when `ISSUED`.
   - What can still be credited counts credit notes that are `ISSUED`, `PENDING` or `UNCERTAIN`, so nothing is credited twice.
   - **An invoice with an ISSUED credit note of type `CORRECTION` is annulled.** It and every credit note on it are left out of the position (spec 7.1.1: Correção cancels the whole invoice).
4. **Legacy documents (spec 7, 7.1.4).**
   - Invoice ITEM line with `partial: false`: units = `quantity`.
   - Invoice ITEM line with `partial: true`: units = `floor(total × (quantity − returnedQuantity) / lineDue)` using the current `coverageDues`, clamped to `0..quantity`. This is spec 7.1.4 with "valor líquido unitário" = `lineDue / effective quantity` (§4: the shown value includes the discount share).
   - SHIPPING line without `shippingLineId`: counts against the line with `origin: 'CHECKOUT'`, or the lowest id when there is none. That line is invoiced.
   - Payments: the active allocations (`uniqueKey` not null) of the invoice.
   - Legacy credit notes (no `metadata.creditType`) read as `RETURN`. Their ITEM units are `partial ? 0 : quantity`.
   - Why: only test data has them (spec 7.1.4), and nothing stored is rewritten.
5. **New invoice rows** store exact units. Each ITEM line has its integer `quantity` and `partial: false`. Each SHIPPING line carries `shippingLineId`. `InvoiceLine` gains `shippingLineId?: number | null`. Units and lines are read back from `lines` alone; no new attribute is added. Each selected payment gets an `invoice-allocation`: `amount` = net value, `coverage: { paymentId, value }`, `uniqueKey: payment:<id>` (the existing unique index still blocks a payment from being invoiced twice).
6. **Remaining quantity of an order line (spec 7.1.2).** `remainingQuantity = max(0, (quantity − returnedQuantity) − (invoicedUnits − returnCreditedUnits))`. This counts only invoices that are not annulled; annulled invoices drop out under ruling 3.
7. **Partial quantity (spec 4).** `selectedValue(remainingValue, remainingQuantity, k) = k === remainingQuantity ? remainingValue : floor(remainingValue × k / remainingQuantity)`. The server and the admin use this same formula (the admin mirrors it, and both have the same tests). The next invoice recomputes the pool, so any rounding is taken up on the last invoice of the line.
8. **Payment net value (spec 7.1.5).**
   - `net = amount − held refunds` attributed to the payment. Held means `COMPLETED`, `PROCESSING` or `PENDING`, money or store credit.
   - A refund linked to a COMPLETED payment counts on that payment, capped at its amount.
   - Refunds without a payment (and any overflow) go into a pool. The pool is attributed latest payment first: first to payments not invoiced, then to invoiced ones.
   - Why: spec 3's example (paid 100, order 90, refund 10 → invoice 90) must also work when the 10 went back as new store credit or as an unlinked manual transfer.
9. **Available payment** = `COMPLETED`, no active allocation, `net > 0`. Payments with net 0 are not listed.
10. **Blocking excess (spec 7.1.7).** `refundableAmount(state.summary, state.inFlightRefunds)`: the summary's excess minus in-flight refunds. This is the same number that offers Refund, so the invoice can be issued right after the Refund step (consistent with 7.1.5).
11. **Issue preconditions and order of checks.**
    1. Order `OPEN`, else `ACTION_NOT_AVAILABLE` (as today).
    2. Blocking excess > 0 → `INVOICE_EXCESS_UNRESOLVED` (409).
    3. Selection issues, from `priceSelection`:
       - `lines.<i>.orderLineId`: `unknown_line` or `duplicate`;
       - `lines.<i>.quantity`: `invalid` (not an integer ≥ 1), or `QUANTITY_EXCEEDS_UNINVOICED` (409);
       - `shippingLineIds.<i>`: `duplicate` (an id already listed), or `SHIPPING_LINE_NOT_INVOICEABLE` (409);
       - `paymentIds.<i>`: `duplicate` (an id already listed), or `PAYMENT_NOT_INVOICEABLE` (409, existing);
       - `lines`: `required` when nothing is selected; `paymentIds`: `required` when no payment is chosen;
       - `paymentIds`: `INVOICE_TOTALS_DIFFER` (400) when the selected total ≠ the payments total or the total is 0.
    4. `expectedTotal` ≠ the computed total → `TOTAL_CHANGED` (409, existing).
12. **Moloni payment methods (spec 5, 7.1.6).**
    - `InvoiceDraft.payments[]` gains `name: string`. The service builds it with `paymentMethodName(method, methodLabel)`: `STRIPE` → `'Stripe'`, `STORE_CREDIT` → `'Crédito em carteira'`, `MANUAL` → the trimmed `methodLabel` (or `''`).
    - The provider resolves each payment's method:
      - `STORE_CREDIT` with `storeCreditPaymentMethodId` configured → that id;
      - empty name → the existing `paymentMethodId()` fallback;
      - any other name → `paymentMethods/getAll`, matched with `trim().toLowerCase()`. On a miss the list is read again uncached, then `paymentMethods/insert { name }` is called and the cache entry is dropped.
    - A name is resolved once per issue.
    - This happens before the customer and the document. An insert failure is `BILLING_REQUEST_FAILED`, not uncertain, and its message never contains the name.
13. **Credit notes (spec 6, 7.1.1).**
    - Input: `creditType: 'RETURN' | 'CORRECTION'`, `reason` (free text, required, ≤ 500, as today), `lines?: { index; quantity }[]` and `shippingIndexes?: number[]` (RETURN only), `idempotencyKey`.
    - **CORRECTION** credits every line's creditable value. An ITEM line that is not partial and has units left uses `quantity = unitsLeft`; other lines use the existing `creditLine` (quantity ratio). It is allowed while the invoice has creditable value. Sending `lines` or `shippingIndexes` with it → `invalid`.
    - **RETURN** credits at most `returnable(i)` units of ITEM line `i`:
      - `returnable(i) = min(unitsLeft_i, overInvoiced_L, returnedLeft_L)`, where `L` is the line's `orderLineId`;
      - `overInvoiced_L = max(0, liveInvoicedUnits_L − liveCreditedUnits_L − (quantity − returnedQuantity))`;
      - `returnedLeft_L = returnedQuantity − liveReturnCreditedUnits_L`;
      - legacy partial lines are never returnable;
      - value = `selectedValue(creditable_i, unitsLeft_i, k)`.
    - RETURN may add whole SHIPPING lines of that invoice that still have creditable value. A RETURN with nothing in it → `lines`/`required`.
    - Above the limit → `QUANTITY_EXCEEDS_CREDITABLE` (409); a shipping index that cannot be credited → `SHIPPING_NOT_CREDITABLE` (409).
    - Stored metadata: `{ locale, reason, creditType, creditedLines: { index, value, quantity }[] }`; `returnIds` is dropped. A legacy `creditedLines` entry without `quantity` counts 0 units.
    - A **CORRECTION that becomes ISSUED** (normal, reconcile or late success) releases the original invoice's allocations (`uniqueKey: null`) in the same transaction as `recordIssued`.
    - On a cancelled order the merchant uses Correção.
14. **Late success (existing `recordLateSuccess`).** Besides the payment check, `DUPLICATE_INVOICE` is also raised when the document no longer fits the position computed without it (`fitsPosition`):
    - some ITEM units exceed that line's `remainingQuantity`;
    - or a SHIPPING `shippingLineId` is already invoiced.
15. **Order action and view.**
    - `INVOICE_TOTAL` is renamed `ISSUE_INVOICE`. It is offered when `invoicing.canIssue` is true: order `OPEN`, some line with `remainingQuantity > 0` or an available shipping line, and at least one available payment.
    - `OrderView.payments[].invoice` is removed (spec 2: no per-payment badge).
    - `OrderView.invoicing: { hasUninvoicedPayments: boolean }` is added (available payments exist). The archive warning uses it.
16. **Shipping line views.**
    - `invoiced` = the line is in `position.shipping` with `invoiced: true` (selection ids plus the legacy rule 4). This replaces the date rule of plan 10 ruling 4.
    - `paid` uses `coveredShipping` = min(shippingTotal, Σ `payment.coverage.shipping.value` over COMPLETED payments) plus the existing discount add-back. This is the settlement coverage, without reconciliation.
17. **Endpoints.**
    - `GET /orders/:id/invoice-preview` becomes `GET /orders/:id/invoice-selection` (`orders.read`), which returns an `InvoiceSelectionView`.
    - `POST /orders/:id/invoices` takes `{ lines, shippingLineIds, paymentIds, expectedTotal, idempotencyKey }`.
    - The credit-note routes keep their paths. Preview returns `CreditNoteOptions`; issue takes ruling 13's input.
    - The storefront API is unchanged.
18. **Modal defaults.** Every product at its full remaining quantity, every available shipping line ticked, and every available payment ticked (the common single-payment case is one click). The modal fetches the selection on open and after any change.

### Amendments (pre-flight)

Applied before execution (scan in `.superpowers/sdd/2026-11-14-ecommerce-11-invoicing-by-selection/progress.md`, "Pre-flight scan"):

- A1. Ruling 11.3 and Task 1: repeated `shippingLineIds` / `paymentIds` entries are refused (`duplicate`), so a shipping line or payment can never be priced twice.
- A2. Task 3: `OrderInvoicing` also exposes `positionOrder: PositionOrder`, which Tasks 5 (`fitsPosition`) and 6 (`creditOptions`) consume. `coverageOrder` is gone after Task 6. `blockingExcess` is passed into `loadInvoicing` by `computeOrderState`. `coveredShipping` reads `payment.coverage.shipping.value` inline, never through `toPaymentCoverage`, which Task 6 deletes.
- A3. Task 4 migrates the existing `InvoiceDraft` fixtures and assertions to the new required `name` (`name: ''`, the fallback path) in `moloniProvider.test.ts` and `invoices.test.ts`.
- A4. Task 5 migrates every old-signature `issue` call in `invoices.test.ts` (activeProvider, late success, getPdf, credit notes) and rewrites the `payments[].invoice` / `INVOICE_TOTAL` assertions of the ported tests. The credit-note suggestion tests are deleted in Task 5 (moved from Task 6): new-format allocations no longer carry the coverage they rely on. `commerceSetup.ts` is added to the Task 5 files.
- A5. Dead code is removed in the task that orphans it: Task 5 removes `isMismatch`, the view's per-payment invoice maps and `NOTHING_TO_INVOICE` from the billing error codes. Task 6 removes `shippingTaxRates` (with its tests), `creditedLinesOf`, `returnIdsOf`, `lineKey` and the private helpers that only the deleted domain functions use. Task 6 keeps `STORE_CREDIT_METHOD_NAME`. The Task 6 grep no longer matches surviving names.
- A6. Task 7 adds the six new error-code translations, moved from Tasks 8 and 9, because `API_ERROR_CODES` is checked against en/pt. It also updates the "covers every code the invoicing endpoints return" test.
- A7. Task 8: `IssueInvoiceModal` gets a `payments` prop for the method and date join. The header button reuses `ecommerce.orders.invoices.generate`.
- A8. Task 9 also edits the gateway and the `fetchCreditNotePreview` use case (the type rename). RETURN counts as available when some `returnable[].units > 0`, because Task 2 lists lines with 0 units.
- A9. Task 2 lists `invoices.ts` among its files (the `creditLine` import).
- A10. Task 1: the all-zero-weights fixture is built through a reachable path, because the pool comes from the order and the documents.

## Global Constraints

- Modules other than e-commerce do not change. The only shared files edited are `admin/src/core/translations/en.json` and `pt.json`. Single tenant, off by default.
- The storefront API contract is unchanged (`docs/ecommerce/storefront-api.md` shapes).
- Never log secrets, Moloni descriptions, customer values or payment method names. The existing Moloni test that asserts error messages carry `field:code` only stays green.
- No automatic refunds, credit notes or e-mails beyond the existing ones. `INVOICE_AVAILABLE` and `CREDIT_NOTE_ISSUED` still go out with the PDF when a document is issued (event `INVOICE_ISSUED`, unchanged).
- Issued invoices never change. Legacy rows are only read (ruling 4).
- Keep the existing safety properties:
  - two-phase issue with a PENDING row committed before the provider call;
  - UNCERTAIN, never re-issued, reconcile / mark failed;
  - idempotency keys (same key → same row; another order or kind → `IDEMPOTENCY_KEY_CONFLICT`);
  - PDF fetched on demand from the issuing provider.
- Money is integer cents with VAT included, capped at `MAX_MONEY_CENTS`. JSON columns hold objects only. No `@strapi/utils` imports.
- The server re-validates everything (spec 3). The admin only helps.
- Admin UI conventions:
  - `OrderSection` `actions` for top-right section buttons, `variant="secondary"` `size="S"`;
  - `ColumnLabel` for column headings;
  - `EmptyNote` for empty states;
  - the Actions column is hidden when no row has an action;
  - text inputs without stepper arrows (`QuantityInput`).
- All new texts go in `en.json` and `pt.json`, keys prefixed `littlebox-strapi-suite.`, pt with correct accents. Keys removed from the code are removed from both files.
- Every task:
  - typecheck with `npx tsc -p server/tsconfig.json --noEmit`, `npx tsc -p admin/tsconfig.json --noEmit` and `npx tsc -p tests/tsconfig.json --noEmit`;
  - run its focused tests with `npx vitest run <paths>`;
  - at the end of each phase, run the full suite with `npx vitest run`;
  - leave the full suite green: old flows are deleted only together with migrating their callers and tests.
- Git:
  - commit with explicit paths, never `git add -A`;
  - never `.yalc/` or `yalc.lock`;
  - commit message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - after each commit run `git branch -f main HEAD`;
  - no push.

## Review Focus

1. **Excess refunded as new store credit or as an unlinked manual transfer.** Paid 100, order lowered to 90, then Refund 10 with no `paymentId`. The selection lists the payment at 90, the invoice is 90, and the Moloni draft has one payment of 90. Pinned in Tasks 1 and 5.
2. **Invoicing right after a Stripe refund that is still PROCESSING.** The blocking excess is 0 and the payment's net already excludes the refund, so the invoice can be issued at once (ruling 10). Pinned in Task 5.
3. **Invoicing a line in parts, then a discount change.** 3 units worth 1000 in total:
   - invoicing 1 unit → 333;
   - a manual order discount is then added;
   - the remaining 2 units are worth the pool left (the 333 stays fixed), and Σ of all parts equals the new total.

   Pinned in Task 1.
4. **An UNCERTAIN invoice.** Its units, shipping lines and payments stay unavailable until it is reconciled. Mark as failed makes all three available again. A late success after a re-invoice is flagged `DUPLICATE_INVOICE` even when the second invoice used different payments (ruling 14). Pinned in Task 5.
5. **Plan 10 orders seeded with legacy invoice rows** (`{ kind: 'SHIPPING', total }`, no ids). The CHECKOUT line reads invoiced, so editing it appends. A line added after that invoice is replaceable. The existing `orders.editShipping` and `orders.editDiscounts` tests stay green. Pinned in Task 3.

---

## Phase 1: Domain rules and order state

### Task 1: Invoicing position, payment nets and selection pricing

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/invoiceSelection.ts` (no Strapi imports)
- Modify: `server/src/services/modules/ecommerce/domain/invoicing.ts` (`InvoiceLine.shippingLineId?: number | null`; export `readInvoiceLines(raw: unknown): InvoiceLine[]`, moved from `linesOf` in `invoices.ts`, which now calls it and also parses `shippingLineId`)
- Modify: `server/src/services/modules/ecommerce/invoices.ts` (use `readInvoiceLines`)
- Test: `tests/server/ecommerce/domain/invoiceSelection.test.ts`

**Interfaces:**
- Produces:
  - `export type CreditType = 'RETURN' | 'CORRECTION'`
  - `export type InvoiceDoc = { id: number; kind: 'INVOICE' | 'CREDIT_NOTE'; status: 'PENDING' | 'ISSUED' | 'FAILED' | 'UNCERTAIN'; creditedInvoiceId: number | null; creditType: CreditType | null; lines: InvoiceLine[]; paymentIds: number[]; creditedLines: { index: number; value: number; quantity: number }[] }`
  - `export function readInvoiceDoc(row: unknown, paymentIds: number[]): InvoiceDoc`. `creditType` comes from `metadata.creditType` (otherwise null); `creditedLines` from `metadata.creditedLines` (quantity missing → 0, ruling 13).
  - `export type PositionOrder = { lines: { id: number; unitPrice: number; unitDiscount: number; quantity: number; returnedQuantity: number; tax: number }[]; orderDiscount: number; shippingTotal: number; shippingTax: number; shippingLines: ShippingLine[] }`
  - `export type PositionLine = { orderLineId: number; invoicedUnits: number; returnCreditedUnits: number; remainingQuantity: number; remainingValue: number }`
  - `export type PositionShipping = { shippingLineId: number; amount: number; invoiced: boolean; available: boolean; remainingValue: number }`
  - `export type PoolPosition = { due: number; invoiced: number; remaining: number }`
  - `export type InvoicingPosition = { lines: PositionLine[]; shipping: PositionShipping[]; products: PoolPosition; shippingPool: PoolPosition; annulledInvoiceIds: number[] }` (lines in order-line order, shipping by id)
  - `export function invoicingPosition(order: PositionOrder, docs: InvoiceDoc[]): InvoicingPosition` (rulings 1–4, 6)
  - `export function paymentNets(payments: { id: number; amount: number }[], refunds: { status: string; amount: number; paymentId: number | null }[], invoicedPaymentIds: Set<number>): Map<number, number>` (`payments` = COMPLETED ones in settlement order; ruling 8)
  - `export const selectedValue = (remainingValue: number, remainingQuantity: number, quantity: number): number` (ruling 7)
  - `export type SelectionRequest = { lines: { orderLineId: number; quantity: number }[]; shippingLineIds: number[]; paymentIds: number[] }`
  - `export type PricedSelection = { lines: { orderLineId: number; quantity: number; value: number }[]; shipping: { shippingLineId: number; value: number }[]; payments: { paymentId: number; value: number }[]; total: number; paymentsTotal: number }`
  - `export function priceSelection(position: InvoicingPosition, payments: { id: number; net: number; available: boolean }[], request: SelectionRequest): { selection: PricedSelection | null; issues: ValidationIssue[] }` (the issues of ruling 11.3, path-indexed by request position; `selection` null when there are issues)
  - `export function fitsPosition(position: InvoicingPosition, doc: InvoiceDoc, order: PositionOrder): boolean` (ruling 14)

- [ ] **Step 1: Write the failing tests.** Fixture: lines A (2 × 1000), B (1 × 500), orderDiscount 300, one CHECKOUT shipping line 500, shippingTotal 500.
  - With no docs: products `{ due: 2200, invoiced: 0, remaining: 2200 }`, A `remainingValue` 1760 and B 440 (equal to `coverageDues`), shipping line 1 `available: true, remainingValue: 500`.
  - New-format invoice `ISSUED` with A × 1 (value 880) and shipping line 1 (500): A `invoicedUnits: 1, remainingQuantity: 1`; products remaining 1320, split A 880 / B 440; shipping line `invoiced: true, available: false`; shippingPool remaining 0.
  - The same invoice `UNCERTAIN` → the same result. `FAILED` → as if absent.
  - `ISSUED` CORRECTION credit note on that invoice → `annulledInvoiceIds: [id]`, and everything is available again with the original values. A `PENDING` CORRECTION → not annulled.
  - Returns:
    - A returned 1 after invoicing 2 → A `remainingQuantity: 0`;
    - then an `ISSUED` RETURN credit note of A × 1 → still 0, products invoiced is net of the credit;
    - a return before invoicing → `remainingQuantity` = 1, nothing to credit.
  - Legacy (ruling 4):
    - partial ITEM line `{ orderLineId: A, quantity: 1, total: 900, partial: true }` with A's lineDue 1760 → `invoicedUnits: 1` (`floor(900 × 2 / 1760)`);
    - non-partial `{ quantity: 2 }` → 2;
    - SHIPPING line without `shippingLineId` → the CHECKOUT line is invoiced;
    - a table with lines [EDIT id 1, MANUAL id 2] → line 1 is invoiced.
  - Negative shipping line −200 → `available: false`. The pool is 300 and goes to line 1 alone.
  - All-zero weights, reached through documents (the pool comes from the order): lines A (1 × 1000) and gift G (1 × 0), `orderDiscount` 500, an ISSUED invoice of A × 1 (500), then `orderDiscount` 0. The pool is 500 and only G has units left (weight 0), so it is split by `remainingQuantity`: G `remainingValue` 500.
  - Review Focus 3: invoice A × 1 = `selectedValue(1760, 2, 1)` = 880. Then `orderDiscount` 300 → 500: A's remaining value + B's = 2000 − 880. Σ of the invoiced and remaining parts = the new products due.
  - `selectedValue(1000, 3, 1) === 333`, `selectedValue(1000, 3, 3) === 1000`, `selectedValue(667, 2, 2) === 667`.
  - `paymentNets`:
    - linked COMPLETED 1000 on P1 → P1 net = amount − 1000;
    - an unlinked 1000 (Review Focus 1) with P1 invoiced and P2 not → it goes to P2;
    - `FAILED` / `CANCELLED` refunds ignored;
    - a refund linked to a payment that is not COMPLETED is ignored;
    - a linked refund above its payment amount → the excess goes to the pool.
  - `priceSelection`:
    - a full valid selection → totals equal and payments' value = their net;
    - every issue code of ruling 11.3 at its path (`lines.1.quantity`/`QUANTITY_EXCEEDS_UNINVOICED`, `shippingLineIds.0`/`SHIPPING_LINE_NOT_INVOICEABLE`, `paymentIds.0`/`PAYMENT_NOT_INVOICEABLE`, `paymentIds`/`INVOICE_TOTALS_DIFFER`, `lines`/`required`, `lines.0.orderLineId`/`duplicate`, `shippingLineIds.1`/`duplicate`, `paymentIds.1`/`duplicate`);
    - a payment with net 0 → `PAYMENT_NOT_INVOICEABLE`.
  - `fitsPosition`: a FAILED doc with A × 2 when A has 1 left → false; a shipping id already invoiced → false; otherwise true.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/invoiceSelection.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `invoiceSelection.ts`. Reuse `allocateProportionally` and `coverageDues` from `domain/orders`, and `ShippingLine` from `domain/shippingLines`. Then move `linesOf` to `readInvoiceLines`.
- [ ] **Step 4: Run** the test, plus `npx vitest run tests/server/ecommerce/invoices.test.ts tests/server/ecommerce/domain/invoicing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): invoicing position, payment nets and selection pricing domain`.

---

### Task 2: Credit options domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/creditNotes.ts`
- Modify: `server/src/services/modules/ecommerce/invoices.ts` (delete its local `creditLine` and import it from `domain/creditNotes`)
- Test: `tests/server/ecommerce/domain/creditNotes.test.ts`

**Interfaces:**
- Consumes: `InvoiceDoc`, `PositionOrder`, `selectedValue` (Task 1); `InvoiceLine` (`domain/invoicing`).
- Produces:
  - `export type CreditOptions = { creditable: number[]; unitsLeft: number[]; returnable: { index: number; units: number; unitsLeft: number; valueLeft: number }[]; shipping: { index: number; value: number }[] }` (per index of the invoice's lines)
  - `export function creditOptions(invoice: InvoiceDoc, docs: InvoiceDoc[], order: PositionOrder): CreditOptions`. Live credit notes on the invoice (ISSUED, PENDING, UNCERTAIN) give `creditable` and `unitsLeft`; `returnable` follows ruling 13.
  - `export type CreditRequest = { creditType: CreditType; lines: { index: number; quantity: number }[]; shippingIndexes: number[] }`
  - `export function buildCreditLines(invoice: InvoiceDoc, options: CreditOptions, request: CreditRequest): { lines: InvoiceLine[]; creditedLines: { index: number; value: number; quantity: number }[]; total: number; issues: ValidationIssue[] }`. Credit lines keep `orderLineId`, `kind`, `sku`, `name`, `tax` and `shippingLineId` of the original line.
  - `export function creditLine(line: InvoiceLine, value: number): InvoiceLine` (moved here from `invoices.ts`, unchanged)

- [ ] **Step 1: Write the failing tests:**
  - An invoice A × 3 (1500) + shipping 500. With A returned 1, `returnable` = `[{ index: 0, units: 1, unitsLeft: 3, valueLeft: 1500 }]`, `shipping` = `[{ index: 1, value: 500 }]`.
  - A `PENDING` RETURN credit of A × 1 on it → `units: 0`, `unitsLeft: 2`.
  - An A quantity reduced by an edit, without a return → `units: 0` (only returned units, ruling 13).
  - RETURN `{ lines: [{ index: 0, quantity: 1 }], shippingIndexes: [1] }` → lines `[A qty 1 total 500, SHIPPING total 500 with the same shippingLineId]`, `creditedLines: [{ index: 0, value: 500, quantity: 1 }, { index: 1, value: 500, quantity: 1 }]`, total 1000.
  - RETURN quantity 2 → `lines.0.quantity`/`QUANTITY_EXCEEDS_CREDITABLE`. Shipping index 0 (an ITEM line) → `shippingIndexes.0`/`SHIPPING_NOT_CREDITABLE`. Empty → `lines`/`required`.
  - CORRECTION after the A × 1 return credit → A qty 2 total 1000 + SHIPPING 500. With `lines` present → `lines`/`invalid`.
  - A legacy partial line `{ quantity: 1, total: 900, partial: true }` is not returnable. CORRECTION credits it through `creditLine` (quantity 1, partial).
  - An invoice line already fully credited → `creditable` 0, and CORRECTION leaves it out.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/creditNotes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `invoices.ts` imports `creditLine` from here.
- [ ] **Step 4: Run** it with `tests/server/ecommerce/invoices.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): credit note options by reason (return, correction)`.

---

### Task 3: The position in the order state and shipping line views

**Files:**
- Modify: `server/src/services/modules/ecommerce/orders.ts`:
  - `OrderInvoicing` gains `positionOrder`, `docs`, `position`, `paymentNets`, `availablePaymentIds`, `blockingExcess`, `coveredShipping` and `canIssue`;
  - `loadInvoicing` computes them. `blockingExcess` is the exception: `computeOrderState` computes it and passes it in as a new argument; the old fields stay until Task 6;
  - `shippingLineContext` is rewritten (ruling 16).
- Modify: `server/src/services/modules/ecommerce/domain/shippingLines.ts`. `shippingLineViews` ctx becomes `{ coveredShipping: number; invoicedLineIds: number[]; hasActiveShipment: boolean }`, and the date rule (`INVOICED_STATUSES`, `timeOf` for invoices) is removed.
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts` (the one `shippingLineContext` call)
- Test: `tests/server/ecommerce/domain/shippingLines.test.ts`, `tests/server/ecommerce/orders.admin.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces, on `OrderState.invoicing`:
  - `positionOrder: PositionOrder` (the input of `invoicingPosition`; Tasks 5 and 6 pass it to `fitsPosition` and `creditOptions`)
  - `docs: InvoiceDoc[]` (live INVOICE and CREDIT_NOTE rows, by id; `paymentIds` from active allocations)
  - `position: InvoicingPosition`
  - `paymentNets: Map<number, number>`
  - `availablePaymentIds: number[]` (ruling 9, settlement order)
  - `blockingExcess: number` (ruling 10)
  - `coveredShipping: number`
  - `canIssue: boolean` (ruling 15)
- `export const shippingLineContext = (invoicing: Pick<OrderInvoicing, 'position' | 'coveredShipping' | 'completedPayments'>, hasActiveShipment: boolean, shippingDiscount: unknown): Parameters<typeof shippingLineViews>[1]`

- [ ] **Step 1: Update and write the failing tests:**
  - `shippingLines.test.ts`: replace "marks invoiced lines by invoice date…" with "marks invoiced lines by id". With `invoicedLineIds: [1]` → `[true, false]`; with `[]` → all false. The `ctx()` helper takes the new shape.
  - `orders.admin.test.ts`, new tests:
    - "a legacy invoice with shipping marks the CHECKOUT line invoiced, a later MANUAL line is not" (Review Focus 5);
    - "computeOrderState exposes the invoicing position": an order paid 4500 has `availablePaymentIds = [paymentId]`, `paymentNets.get(paymentId) === 4500`, `canIssue: true` and `blockingExcess: 0`; after adding a 1000 manual discount, `blockingExcess` = 1000.
  - The existing tests "marks the shipping line paid once the total is paid", "marks the CHECKOUT line paid on a fully paid free-shipping order" and "never marks … unpaid free-shipping order" stay green with the settlement-based `coveredShipping`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/shippingLines.test.ts tests/server/ecommerce/orders.admin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `loadInvoicing` builds `PositionOrder` from `lines`, `order.orderDiscount`, `order.shippingTotal`, `order.shippingTax` and `readShippingLines(order)`. It builds `docs` with `readInvoiceDoc(row, paymentIdsOf(row.id))`.
  - `paymentNets` gets the completed payments, the refunds and the set of payments with an active allocation.
  - `blockingExcess = refundableAmount(summary, inFlightRefunds)` is computed in `computeOrderState`, after `summary` and `inFlightRefunds` and before the `loadInvoicing` call. It is passed to `loadInvoicing` as an argument.
  - `coveredShipping` reads `payment.coverage.shipping.value` with a small inline parser in `orders.ts`. It does not call `toPaymentCoverage`, which Task 6 deletes.
  - `canIssue = order.orderStatus === 'OPEN' && (position.lines.some((l) => l.remainingQuantity > 0) || position.shipping.some((s) => s.available)) && availablePaymentIds.length > 0`.
- [ ] **Step 4: Run** those tests, then `npx vitest run tests/server/ecommerce/orders.editShipping.test.ts tests/server/ecommerce/orders.editDiscounts.test.ts tests/server/ecommerce/orderEditing.runner.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): invoicing position in the order state; shipping lines invoiced by id`.
- [ ] **Step 6: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 2: Server issue, credit notes and Moloni

### Task 4: Moloni payment methods by name

**Files:**
- Modify: `server/src/services/modules/ecommerce/providers/billing/types.ts` (`InvoiceDraft.payments[]` gains `name: string`)
- Modify: `server/src/services/modules/ecommerce/domain/invoicing.ts` (add `paymentMethodName`)
- Modify: `server/src/services/modules/ecommerce/providers/billing/moloni/provider.ts`
- Modify: `server/src/services/modules/ecommerce/invoices.ts` (the current draft sets `name: paymentMethodName(p.method, p.metadata?.methodLabel)`)
- Modify: `admin/src/core/translations/en.json`, `pt.json`: the help texts of `…moloni.fields.paymentMethodId.help` and `…storeCreditPaymentMethodId.help`
- Test: `tests/server/ecommerce/providers/moloniProvider.test.ts`, `tests/server/ecommerce/domain/invoicing.test.ts`, `tests/server/ecommerce/invoices.test.ts` (the `draft.payments` `toEqual` in "Review Focus 3: a paid line replaced…" adds `name: ''`)

**Interfaces:**
- Produces (in `domain/invoicing.ts`):
  - `export const STORE_CREDIT_METHOD_NAME = 'Crédito em carteira'`
  - `export function paymentMethodName(method: string, methodLabel: unknown): string` (ruling 12)
  - Moloni: `issue` resolves `payment_method_id` per draft payment (ruling 12). The provider never reads `draft.payments[].method` except for `STORE_CREDIT`.

- [ ] **Step 1: Write the failing tests** (`moloniFake`):
  - Existing fixtures first: the base `draft()` payment and every inline draft payment in `moloniProvider.test.ts` get `name: ''`. That is the fallback path, so they keep today's ids and `happyRoutes` needs no `paymentMethods/insert`. The test "uses the configured document set and payment methods…" keeps its store-credit payment on `storeCreditPaymentMethodId` 99.
  - "payment methods are matched by name, ignoring case and outer spaces": `paymentMethods/getAll` → `[{ payment_method_id: 7, name: ' mb way ' }]`; draft payment `name: 'MB WAY'` → `payments[0].payment_method_id === 7`; `paymentMethods/insert` is not called.
  - "a missing method is created before the customer and the document": getAll → `[{ payment_method_id: 1, name: 'Numerário' }]`; insert → `{ valid: 1, payment_method_id: 9 }`. The document uses 9. `paths()` shows `paymentMethods/insert` before `customers/getByVat` and `invoiceReceipts/insert`. getAll was called twice (the uncached re-read), and the insert body has `name: 'MB WAY'`.
  - "one draft with two payments of the same name resolves it once".
  - "store credit uses `storeCreditPaymentMethodId` when configured, otherwise 'Crédito em carteira'". This replaces "store credit falls back to paymentMethodId".
  - "an empty name uses `paymentMethodId`" (the configured id, else the first of the list).
  - "`paymentMethods/insert` refused → BILLING_REQUEST_FAILED, not uncertain, no customer or document call, and the message does not contain the name" (`expect(err.message).not.toMatch(/MB WAY/)`).
  - `invoicing.test.ts`: `paymentMethodName('STRIPE', 'x') === 'Stripe'`, `('STORE_CREDIT', null) === 'Crédito em carteira'`, `('MANUAL', '  MB WAY ') === 'MB WAY'`, `('MANUAL', null) === ''`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/providers/moloniProvider.test.ts tests/server/ecommerce/domain/invoicing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `context(rt)`, add `paymentMethodIdByName(name: string): Promise<number>`. It reads with `client.call('paymentMethods/getAll')` through the `lookups` map, and an empty list is allowed (unlike `list`). On a miss it deletes the cache key and reads again, then inserts. A missing `payment_method_id` in the answer → `requestFailed('Moloni did not return the new payment method id.')`.
  - In `issue`, use a per-call `Map<string, Promise<number>>` keyed by the normalized name.
  - Help texts:
    - en `paymentMethodId.help`: "Used for manual payments without a method name, and for new customers. Stripe payments and named manual methods are matched by name in Moloni (created there when missing). …" (keep the list and fallback paragraphs);
    - pt: "Usado nos pagamentos manuais sem nome de método e nos clientes novos. Os pagamentos Stripe e os métodos manuais com nome são procurados no Moloni pelo nome (e criados lá se não existirem). …";
    - storeCredit help, last paragraph: en "Left empty, a method named "Crédito em carteira" is used (created in Moloni when missing)." / pt "Se ficar vazio, é usado um método chamado "Crédito em carteira" (criado no Moloni se não existir).".
- [ ] **Step 4: Run** the tests and `npx vitest run tests/server/ecommerce/providers tests/server/ecommerce/invoices.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): Moloni payment method per payment, found or created by name`.

---

### Task 5: Issue an invoice from a selection

**Files:**
- Modify: `server/src/services/modules/ecommerce/invoices.ts`:
  - remove `InvoiceScope`, `normalizeScope`, `compose` and `preview`;
  - add `selection` and the new `issue`;
  - `recordLateSuccess` gets the `fitsPosition` check (ruling 14), with `state.invoicing.position` and `state.invoicing.positionOrder`;
  - `NOTHING_TO_INVOICE` is no longer thrown;
  - delete `isMismatch`, which only `issue` used.
- Modify: `server/src/services/modules/ecommerce/errors.ts` (remove `NOTHING_TO_INVOICE` from the billing error codes)
- Modify: `server/src/controllers/modules/ecommerce/invoices.ts` (`selection`, `issue`; delete `scopeOf`)
- Modify: `server/src/routes/ecommerce/admin-invoices.ts` (`GET /orders/:id/invoice-selection` → `${I}.selection`, `orders.read`)
- Modify: `server/src/controllers/modules/ecommerce/errors.ts` (`CONFLICT_CODES` += `INVOICE_EXCESS_UNRESOLVED`, `QUANTITY_EXCEEDS_UNINVOICED`, `SHIPPING_LINE_NOT_INVOICEABLE`)
- Modify: `server/src/services/modules/ecommerce/domain/orders.ts` (`OrderActionKey` `INVOICE_TOTAL` → `ISSUE_INVOICE`; input `hasUninvoicedCompletedPayments` → `canIssueInvoice`)
- Modify: `server/src/services/modules/ecommerce/orders.ts` (pass `canIssueInvoice: invoicing.canIssue`; the view drops `payments[].invoice` and the maps only it used, `activeInvoiceOf` and `statusOfInvoice`, and adds `invoicing: { hasUninvoicedPayments }`)
- Modify: `tests/server/ecommerce/helpers/commerceSetup.ts` (`testIssueAll`)
- Test: `tests/server/ecommerce/invoices.test.ts` (the issue, reconcile and late-success sections ported, plus every other call of the old `issue` signature in the file), `tests/server/ecommerce/invoicesController.test.ts`, `tests/server/ecommerce/fulfillmentRoutes.test.ts`, `tests/server/ecommerce/notifications.test.ts` (callers of `inv.issue`), `tests/server/ecommerce/domain/orders.test.ts`, `tests/server/ecommerce/orders.create.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - `export type InvoiceSelectionView = { lines: { orderLineId: number; sku: string; name: string; option: string | null; tax: number; isGift: boolean; remainingQuantity: number; remainingValue: number }[]; shipping: { shippingLineId: number; name: string; tax: number; origin: ShippingLineOrigin; createdAt: string; value: number }[]; payments: { paymentId: number; amount: number; refunded: number; net: number }[]; excess: number }`. Lines have `remainingQuantity > 0`; shipping lines are available; payments are available. All are empty when the order is not OPEN.
  - `selection(orderId: number | string): Promise<InvoiceSelectionView>`
  - `export type IssueInvoiceInput = SelectionRequest & { expectedTotal: number; idempotencyKey: string }`
  - `issue(orderId: number | string, input: IssueInvoiceInput, actor: string): Promise<InvoiceView>`
  - A helper `testIssueAll(c, orderId, key)` in `tests/server/ecommerce/helpers/commerceSetup.ts`: it reads `selection` and issues everything with every payment. The ported tests use it.

- [ ] **Step 1: Write the failing tests** (`invoices.test.ts`, `describe('EcommerceInvoiceService.issue')`, rewritten):
  - "issues a PENDING row with allocations before calling the provider, then ISSUED + history + event": the draft lines are ITEMs with exact quantities and one SHIPPING line with `shippingLineId: 1`. The draft payments are `[{ method: 'MANUAL', amount: 4500, name: '', date }]`. The allocation is `{ amount: 4500, coverage: { paymentId, value: 4500 }, uniqueKey: 'payment:<id>' }`.
  - "three payments → one invoice": three manual payments 1500 each (methodLabels 'MB WAY', '', 'Transferência') → one invoice of 4500 and three draft payments with those names.
  - "invoices in parts": first A × 1 with P1, then the rest with P2. The second selection lists only what is left, and Σ the two totals = the order total.
  - "a gift line at 0 € is invoiced as a 0 line".
  - "a negative shipping line is never offered and lowers the shipping value".
  - "totals that differ → INVOICE_TOTALS_DIFFER and nothing is written"; "expectedTotal stale → TOTAL_CHANGED"; "a quantity above what is left → QUANTITY_EXCEEDS_UNINVOICED (409 via the controller)".
  - Review Focus 1: "excess refunded as new store credit: the payment is listed at its net and the invoice is the net".
  - Review Focus 2: "a PROCESSING Stripe refund (the Stripe client stub) leaves no blocking excess: the invoice issues at once".
  - "unrefunded excess → INVOICE_EXCESS_UNRESOLVED, and selection().excess equals it".
  - Review Focus 4: "UNCERTAIN keeps units, shipping and payment unavailable; markFailed returns all three".
  - "a late success after the same units were invoiced with another payment → DUPLICATE_INVOICE, no customer event".
  - "a cancelled order refuses new invoices" (`ACTION_NOT_AVAILABLE`).
  - "repeating issue with the same idempotencyKey returns the same invoice and calls the provider once".
  - Port these with the new call: reconcile found, not found and markFailed; "reconcile keeps the state …"; "a provider without a declared maximum …"; "a definitive error → no document kept …"; "a refusal reaches the caller …"; "an unexpected error keeps its class and message …"; "logs and falls back to UTC …"; "a payment that is not COMPLETED … → PAYMENT_NOT_INVOICEABLE" (now `paymentIds.0`); "a refunded payment is invoiced net of its refunds".
    - Their assertions on `payments[].invoice` (`invoiceable`, `invoiceId`, `status`) become `invoicing.hasUninvoicedPayments` and `(await inv.selection(id)).payments`.
    - `INVOICE_TOTAL` becomes `ISSUE_INVOICE`.
  - Every other old-signature call in the file moves to `testIssueAll` or to the new input (`paymentIds: [id]` with the full selection):
    - the `activeProvider` describe;
    - the late-success describe (both cases, with their `payments[].invoice` assertions rewritten as above);
    - `getPdf`;
    - the kept credit-note tests.

    Task 6 rewrites the credit-note section afterwards, but it must stay green here.
  - Delete with their replacements above: "Review Focus 3: a paid line replaced …", "total invoice with two payments …", "a coverage mismatch …", "a refund without a payment is attributed first …" and "INVOICE_TOTAL only with uninvoiced payments".
  - Also delete the credit-note suggestion tests here; this moves them from Task 6. They are "a return after invoicing is suggested …", "… an order discount …", "units returned on a cancelled order …", the "a refund and a credit note never both remove the same value" block and "suggestions over two invoices …". They issue per-payment invoices, and they rely on allocation coverages, which new-format allocations no longer carry. `creditPosition` stays until Task 6.
  - `domain/orders.test.ts`: "paid with something to invoice offers ISSUE_INVOICE"; `orders.create.test.ts:773` expects `['SHIP', 'CANCEL', 'ISSUE_INVOICE']`.
  - Controller:
    - "selection passes the id";
    - "issue returns 201 and validates lines (positive integers), shippingLineIds and paymentIds (positive-integer arrays, at most 200), expectedTotal (cents) and idempotencyKey";
    - "INVOICE_EXCESS_UNRESOLVED, QUANTITY_EXCEEDS_UNINVOICED and SHIPPING_LINE_NOT_INVOICEABLE are 409".
  - Routes: `['GET', \`${A}/orders/:id/invoice-selection\`, \`${I}.selection\`, P.ordersRead]`.
  - The order view has no `payments[].invoice`, and has `invoicing.hasUninvoicedPayments`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/invoices.test.ts tests/server/ecommerce/invoicesController.test.ts tests/server/ecommerce/fulfillmentRoutes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `issue` keeps `findByKey` → `activeProvider` → `twoPhase`. Inside `prepare`:
  1. `computeOrderState`;
  2. the ruling 11 checks;
  3. `priceSelection`;
  4. build the lines: ITEM `name` = `option ? \`${name} - ${option}\` : name`, `sku`, `tax`, `partial: false`; SHIPPING `sku: 'SHIPPING'`, `name: clean(line.name) || 'Shipping'`, the line's `tax`, `shippingLineId`;
  5. `createPending` and one allocation per payment;
  6. the draft: payment `amount` = its value, `name: paymentMethodName(…)`, `date: dateIn(p.completedAt, tz)`.

  Validation issues throw `EcommerceValidationError('Invalid invoice', issues)` before any row is written. The `INVOICE_ISSUED` history `newValue` adds `selection: { lines, shippingLineIds, paymentIds }` (ids, quantities, values; never names).
- [ ] **Step 4: Run** the focused tests and `npx vitest run tests/server/ecommerce/notifications.test.ts tests/server/ecommerce/domain/orders.test.ts tests/server/ecommerce/orders.create.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): issue invoices from a selection of products, shipping and payments`.

---

### Task 6: Credit notes by reason; remove coverage reconciliation

**Files:**
- Modify: `server/src/services/modules/ecommerce/invoices.ts`:
  - `creditNotePreview` returns `CreditNoteOptions`, and `issueCreditNote` takes `CreditNoteInput` (ruling 13);
  - `recordIssued` releases the original's allocations for an ISSUED CORRECTION;
  - delete `creditPosition` and the old suggestion logic, with the helpers only they use: `creditedLinesOf`, `returnIdsOf`, `lineKey` and the `allocateProportionally` / `OrderStatus` imports.
- Modify: `server/src/controllers/modules/ecommerce/invoices.ts` (`issueCreditNote` validation)
- Modify: `server/src/controllers/modules/ecommerce/errors.ts` (`CONFLICT_CODES` += `QUANTITY_EXCEEDS_CREDITABLE`, `SHIPPING_NOT_CREDITABLE`)
- Modify: `server/src/services/modules/ecommerce/domain/invoicing.ts`. Delete `CoverageValue`, `ReconciledCoverage`, `InvoicedCoverage`, `InvoiceOrderState`, `OverInvoiced`, `toInvoicedCoverage`, `toPaymentCoverage`, `reconcileCoverages`, `invoiceableByPayment`, `buildInvoiceLines`, `overInvoiced`, `uninvoicedByPayment`, `creditNoteBudget`, `suggestCreditNote` and `validateCreditNoteRequest`, plus the private helpers and imports that only they use (`parseLines`, `isCents`, `lineKey`, …). Keep `InvoiceLine`, `InvoiceCustomer`, `invoiceCustomer`, `issueDate`, `readInvoiceLines`, `STORE_CREDIT_METHOD_NAME` and `paymentMethodName`.
- Modify: `server/src/services/modules/ecommerce/domain/shippingLines.ts`. Delete `shippingTaxRates`; its only caller, `compose`, went in Task 5.
- Modify: `server/src/services/modules/ecommerce/orders.ts`. `OrderInvoicing` drops `coverageOrder`, `refunded`, `reconciled` and `invoiceable`. Delete `refundedByPayment`. `completedPayments`, `allocations` and `invoices` stay.
- Test: `tests/server/ecommerce/invoices.test.ts` (credit notes section rewritten), `tests/server/ecommerce/invoicesController.test.ts`, `tests/server/ecommerce/notifications.test.ts` (the `issueCreditNote` call), `tests/server/ecommerce/domain/invoicing.test.ts` (delete the describes of the deleted functions: coverage mappers, reconcileCoverages ×2, buildInvoiceLines ×2, overInvoiced, credit notes, uninvoicedByPayment, creditNoteBudget, and the `shippingTaxRates` import), `tests/server/ecommerce/domain/shippingLines.test.ts` (delete the `shippingTaxRates` describe and import). Also any `refundedByPayment` test in `tests/server/ecommerce/orders.*.test.ts` (grep).

**Interfaces:**
- Consumes: Task 2 (`creditOptions`, `buildCreditLines`), Task 3.
- Produces:
  - `export type CreditNoteOptions = { lines: InvoiceLine[]; creditable: number[]; correction: { lines: InvoiceLine[]; total: number }; returnable: CreditOptions['returnable']; shipping: CreditOptions['shipping'] }`
  - `export type CreditNoteInput = { creditType: CreditType; lines?: { index: number; quantity: number }[]; shippingIndexes?: number[]; reason: string; idempotencyKey: string }`
  - `creditNotePreview(invoiceId): Promise<CreditNoteOptions>`, `issueCreditNote(invoiceId, input: CreditNoteInput, actor): Promise<InvoiceView>`

- [ ] **Step 1: Write the failing tests** (`describe('EcommerceInvoiceService credit notes')`, rewritten):
  - "RETURN credits returned units at their invoiced value": invoice A × 2 + shipping. Return 1 A → preview `returnable[0].units === 1`. Issue `{ creditType: 'RETURN', lines: [{ index: 0, quantity: 1 }] }` → the draft has A qty 1 and `payments: []`, and `metadata.creditType === 'RETURN'`. Afterwards the selection does not list A, and the allocation stays active.
  - "RETURN can add the invoice's shipping line; it stays invoiced".
  - "CORRECTION annuls the invoice: once ISSUED, products, shipping and payments are available again and the allocation uniqueKey is null; the correct invoice can then be issued with the same payment".
  - "a CORRECTION that ends UNCERTAIN keeps everything invoiced; reconcile found → released then".
  - "CORRECTION after a RETURN credit credits only what is left; the returned unit is not offered again".
  - "RETURN above the returnable units → QUANTITY_EXCEEDS_CREDITABLE (409)"; "RETURN with nothing → lines required"; "CORRECTION with lines → invalid".
  - Keep (ported to the new input): "the draft reuses the original customerData and locale, payments [] and the original"; "repeating issueCreditNote with the same key …"; "credit note on an invoice that is not ISSUED → ACTION_NOT_AVAILABLE; provider without creditNotes → NOT_SUPPORTED"; "reconcile of a credit note found → INVOICE_ISSUED with kind CREDIT_NOTE"; "a cancelled order allows a CORRECTION credit note".
  - The suggestion tests are already gone (deleted in Task 5). Spec 6 replaces suggestions with the chosen reason.
  - Controller: "credit note issue validates creditType (RETURN | CORRECTION), lines (index ≥ 0, quantity ≥ 1), shippingIndexes, reason ≤ 500 and idempotencyKey"; "QUANTITY_EXCEEDS_CREDITABLE is a 409".
  - Notifications: the `CREDIT_NOTE_ISSUED` e-mail with PDF still goes out (`issueCreditNote(view.id, { creditType: 'CORRECTION', reason: 'x', idempotencyKey: 'c1' }, actor)`).
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/invoices.test.ts tests/server/ecommerce/invoicesController.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `issueCreditNote`'s `prepare` reloads the ISSUED original, computes `creditOptions(readInvoiceDoc(original, …), state.invoicing.docs, state.invoicing.positionOrder)`, then `buildCreditLines`. Issues throw before any row.
  - Metadata `{ locale, reason, creditType, creditedLines }`; the draft is unchanged otherwise.
  - The release in `recordIssued`: `if (row.kind === 'CREDIT_NOTE' && row.metadata?.creditType === 'CORRECTION') await releaseAllocations(idOf(row.creditedInvoice))`. The history `newValue` adds `creditType`.
  - Then delete the old domain and state code. `grep -rnE "reconcileCoverages|invoiceableByPayment|invoicing\.invoiceable|refundedByPayment|creditNoteBudget|shippingTaxRates|toPaymentCoverage|coverageOrder" server tests` → nothing. A plain `invoiceable` would also match names that survive on purpose, such as `notInvoiceable` and test titles.
- [ ] **Step 4: Run** the focused tests and `npx vitest run tests/server/ecommerce`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): credit notes by reason (return, correction); remove payment coverage reconciliation`.
- [ ] **Step 6: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 3: Admin

### Task 7: Admin data layer for the selection

**Files:**
- Modify: `admin/src/ecommerce/orderTypes.ts`:
  - add `InvoiceSelectionView`, `IssueInvoiceSelectionInput` and `InvoiceLine.shippingLineId?: number | null`;
  - `OrderActionKey` `INVOICE_TOTAL` → `ISSUE_INVOICE`;
  - `Order.invoicing: { hasUninvoicedPayments: boolean }`;
  - remove `PaymentInvoiceInfo` and `OrderPayment.invoice`.

  `InvoiceScopeInput`, `InvoicePreview` and `IssueInvoiceInput` stay until Task 8.
- Modify: `admin/src/ecommerce/gateways/ecommerceOrdersGateway.ts` (add `fetchInvoiceSelection(orderId): Promise<InvoiceSelectionView>` → `GET …/orders/:id/invoice-selection`; `issueInvoice` changes its input type in Task 8, together with the modal that calls it)
- Create: `admin/src/ecommerce/usecases/orders/fetchInvoiceSelection.ts`
- Create: `admin/src/ecommerce/utils/invoiceSelection.ts`
- Modify: `admin/src/ecommerce/utils/invoiceForm.ts` (remove `hasUninvoicedPayments`), `admin/src/ecommerce/utils/orderDetail.ts` (remove `paymentRowHasActions`; `API_ERROR_CODES` += `INVOICE_EXCESS_UNRESOLVED`, `INVOICE_TOTALS_DIFFER`, `QUANTITY_EXCEEDS_UNINVOICED`, `SHIPPING_LINE_NOT_INVOICEABLE`, `QUANTITY_EXCEEDS_CREDITABLE`, `SHIPPING_NOT_CREDITABLE`; remove `NOTHING_TO_INVOICE`)
- Modify (the callers, so admin typechecks): `PaymentsTable.tsx` (drop the invoice badge, the button, the props and the Actions column), `InvoicesSection.tsx` (`ISSUE_INVOICE`; `showBillingHint` uses it), `OrderDetailPage.tsx` (archive warning reads `order.invoicing.hasUninvoicedPayments`; stop passing invoice props to `PaymentsTable`)
- Test: `tests/admin/ecommerce/invoiceSelection.test.ts` (new), `tests/admin/ecommerce/invoiceForm.test.ts`, `tests/admin/ecommerce/orderDetail.test.ts`

**Interfaces:**
- Produces (`utils/invoiceSelection.ts`):
  - `export const selectedValue` (the same formula as the server, ruling 7)
  - `export type InvoiceSelectionForm = { quantities: Record<number, number>; shipping: number[]; payments: number[] }`
  - `export function defaultInvoiceSelectionForm(view: InvoiceSelectionView): InvoiceSelectionForm` (ruling 18)
  - `export function validateInvoiceSelection(view, form): FormErrors` (`quantities.<orderLineId>`: `exceeds_remaining`)
  - `export function invoiceSelectionTotals(view, form): { selected: number; payments: number; difference: number; canIssue: boolean }` (`canIssue` = no errors, `excess === 0`, `selected === payments > 0`)
  - `export function buildIssueInvoiceInput(view, form, idempotencyKey: string): IssueInvoiceSelectionInput` (quantity-0 lines left out; `expectedTotal = selected`)
  - `export function unitValue(line: InvoiceSelectionView['lines'][number]): number` (`Math.round(remainingValue / remainingQuantity)`, display only)

- [ ] **Step 1: Write the failing tests:**
  - `selectedValue` uses the same vectors as the server (333 / 1000 / 667).
  - The default form selects everything.
  - Totals:
    - two lines + shipping = 4500 with a payment of 4500 → `canIssue: true`;
    - unticking the payment → `payments: 0, difference: 4500, canIssue: false`;
    - `excess: 1000` → `canIssue: false` even when equal;
    - a quantity above the remaining → the error and `canIssue: false`.
  - `buildIssueInvoiceInput` leaves quantity 0 out and sets `expectedTotal`.
  - `orderDetail.test.ts`:
    - delete the `paymentRowHasActions` describe;
    - in the toolbar test, `INVOICE_TOTAL` → `ISSUE_INVOICE`;
    - in "covers every code the invoicing endpoints return", drop `NOTHING_TO_INVOICE` and add the six new codes. The existing `it.each(API_ERROR_CODES)` en/pt check then covers them.
  - `invoiceForm.test.ts`: delete the `hasUninvoicedPayments` describe.
- [ ] **Step 2: Run** `npx vitest run tests/admin/ecommerce/invoiceSelection.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Remove the translation keys this task no longer uses (`detail.payments.invoice.*`, `detail.payments.actions`) from en and pt.
  - Add the `ecommerce.orders.errors.` messages of the six codes added to `API_ERROR_CODES`, because `orderDetail.test.ts` requires an en and a pt message for every code. Use the texts listed in Task 8 (`INVOICE_EXCESS_UNRESOLVED`, `INVOICE_TOTALS_DIFFER`, `QUANTITY_EXCEEDS_UNINVOICED`, `SHIPPING_LINE_NOT_INVOICEABLE`) and Task 9 (`QUANTITY_EXCEEDS_CREDITABLE`, `SHIPPING_NOT_CREDITABLE`). Tasks 8 and 9 then only change `PAYMENT_NOT_INVOICEABLE` and remove keys.
- [ ] **Step 4: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): admin invoice selection model; payments lose the per-payment invoice action`.

---

### Task 8: Gerar fatura modal

**Files:**
- Rewrite: `admin/src/ecommerce/components/orders/IssueInvoiceModal.tsx`. Props: `{ orderId: number; payments: OrderPayment[]; canRefund: boolean; onClose(): void; onIssued(): void; onRefund(): void }`. `payments` is `order.payments`, for the method and date join. Keep the existing behaviour around attempts:
  - one idempotency key per opening;
  - `InvoiceErrorModal` on a refusal;
  - the uncertain box;
  - after an attempt only Close remains;
  - the warning toast for `issuedWarnings`.
- Body:
  - three sub-tables with `ColumnLabel` headings, each with `EmptyNote` when empty:
    - **Products**: product (name, option, sku), net unit price (`unitValue`), to invoice (`remainingQuantity`), quantity to invoice (`QuantityInput`, error "At most {max}."), value (`selectedValue`);
    - **Shipping**: a checkbox, name, date and value;
    - **Payments**: a checkbox, method (`methodLabel` or the translated method, joined from the `payments` prop by id), date, paid, refunded, net;
  - below them **Selected total** and **Payments total**, and when they differ "Difference: {amount}";
  - with `excess > 0`, a warning box "{amount} was paid in excess. Refund it before invoicing." with a **Refund** button (`canRefund`) that calls `onRefund`; **Generate** stays disabled.
  - **Generate** is enabled only when `invoiceSelectionTotals(...).canIssue`.
- Delete: `admin/src/ecommerce/usecases/orders/fetchInvoicePreview.ts`; in `orderTypes.ts`, `InvoiceScopeInput`, `InvoicePreview` and `IssueInvoiceInput`; `fetchInvoicePreview` from the gateway. The gateway's `issueInvoice(orderId, input: IssueInvoiceSelectionInput)` and `usecases/orders/issueInvoice.ts` take the new input.
- Modify: `InvoicesSection.tsx`. The header button **Generate invoice** (the existing key `ecommerce.orders.invoices.generate`, `variant="secondary" size="S"`, disabled without billing) is shown when `canInvoice && order.availableActions.includes('ISSUE_INVOICE')`. `onIssue: () => void`.
- Modify: `OrderDetailPage.tsx`. `invoiceOpen: boolean` replaces `invoiceScope`, and `invoiceKey` remounts the modal per opening. `onRefund` closes it and runs `dispatchModal({ type: 'OPEN', action: 'REFUND' })`.
- Modify: translations (en / pt), under `ecommerce.orders.invoices.issue.`:
  - `products` "Products" / "Produtos"
  - `shipping` "Shipping" / "Portes"
  - `payments` "Payments" / "Pagamentos"
  - `columns.product` "Product" / "Produto"
  - `columns.unitValue` "Net unit price" / "Preço líquido unitário"
  - `columns.remaining` "To invoice" / "Por faturar"
  - `columns.quantity` "Quantity to invoice" / "Quantidade a faturar"
  - `columns.value` "Value" / "Valor"
  - `columns.select` "Invoice" / "Faturar"
  - `columns.name` "Shipping" / "Portes"
  - `columns.date` "Date" / "Data"
  - `columns.method` "Method" / "Método"
  - `columns.paid` "Paid" / "Pago"
  - `columns.refunded` "Refunded" / "Reembolsado"
  - `columns.net` "Net value" / "Valor líquido"
  - `selectedTotal` "Selected total" / "Total selecionado"
  - `paymentsTotal` "Payments total" / "Total dos pagamentos"
  - `difference` "Difference: {amount}" / "Diferença: {amount}"
  - `excess` "{amount} was paid in excess. Refund it before invoicing." / "Há {amount} pagos a mais. Faça o reembolso antes de faturar."
  - `refund` "Refund" / "Reembolsar"
  - `noProducts` "Every product is invoiced." / "Todos os produtos estão faturados."
  - `noShipping` "No shipping left to invoice." / "Não há portes por faturar."
  - `noPayments` "No payments left to invoice." / "Não há pagamentos por faturar."
  - `atMost` "At most {max}." / "No máximo {max}."
  - `gift` "Gift" / "Oferta"
  - `confirm` "Generate" / "Gerar" (new value)
  - `previewError` "The invoice data could not be loaded." / "Não foi possível carregar os dados da fatura." (new value)

  Error codes, `ecommerce.orders.errors.` (the first four are added in Task 7, see A6; they are listed here for their texts):
  - `INVOICE_EXCESS_UNRESOLVED` "This order has money paid in excess. Refund it before invoicing." / "A encomenda tem valor pago a mais. Faça o reembolso antes de faturar."
  - `INVOICE_TOTALS_DIFFER` "The selected total must equal the payments total." / "O total selecionado tem de ser igual ao total dos pagamentos."
  - `QUANTITY_EXCEEDS_UNINVOICED` "A quantity is above what is left to invoice. Reload the order." / "Uma quantidade é superior à que falta faturar. Volte a carregar a encomenda."
  - `SHIPPING_LINE_NOT_INVOICEABLE` "A shipping line is no longer available to invoice. Reload the order." / "Uma linha de portes já não está disponível para faturar. Volte a carregar a encomenda."
  - `PAYMENT_NOT_INVOICEABLE` (new value) "A payment is no longer available to invoice. Reload the order." / "Um pagamento já não está disponível para faturar. Volte a carregar a encomenda."

  Remove: `invoices.generateTotal`, `invoices.issue.titleTotal`, `invoices.lines.partialHint`, `errors.NOTHING_TO_INVOICE`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 3: Manual check** on the test project (memory: backend-base on :1337).
  - Three manual payments, then one invoice: the button is enabled only when the totals match.
  - Then an order paid 100, lowered to 90: the modal shows the excess box. **Refund** opens the refund modal; after it, the invoice of 90 issues.
  - In Moloni, the document has one payment per payment, and a missing method name was created.
- [ ] **Step 4: Commit** `feat(ecommerce): Generate invoice modal (products, shipping and payments selection)`.

---

### Task 9: Credit note modal with a reason

**Files:**
- Modify: `admin/src/ecommerce/orderTypes.ts`: `CreditNotePreview` becomes `CreditNoteOptions`, and `CreditNoteInput` takes the ruling 13 shape.
- Modify (they import `CreditNotePreview`): `admin/src/ecommerce/gateways/ecommerceOrdersGateway.ts` (`fetchCreditNotePreview(invoiceId): Promise<CreditNoteOptions>`) and `admin/src/ecommerce/usecases/orders/fetchCreditNotePreview.ts`.
- Modify: `admin/src/ecommerce/utils/invoiceForm.ts`. Replace `emptyCreditNoteForm`, `validateCreditNoteForm`, `creditNoteTotal` and `buildCreditNoteInput` with:
  - `export type CreditNoteForm = { creditType: 'RETURN' | 'CORRECTION'; quantities: Record<number, number>; shipping: number[]; reason: string }`
  - `export function emptyCreditNoteForm(options: CreditNoteOptions): CreditNoteForm` (`RETURN` when some `returnable[].units > 0`, else `CORRECTION`; quantities empty)
  - `export function validateCreditNoteForm(form, options): FormErrors`: `quantities.<index>` `exceeds_creditable`; `lines` `required` (RETURN with nothing); `reason` `required` / `too_long`
  - `export function creditNoteTotal(form, options): number` (RETURN: Σ `selectedValue(valueLeft, unitsLeft, k)` + the shipping values; CORRECTION: `options.correction.total`)
  - `export function buildCreditNoteInput(form, idempotencyKey): CreditNoteInput`
- Rewrite: `admin/src/ecommerce/components/orders/CreditNoteModal.tsx`.
  - A radio group **Reason**: Return / Correction, each with its hint. RETURN is disabled with the hint `nothingReturnable` when no `returnable` entry has `units > 0`. Task 2 also lists lines with 0 units.
  - RETURN shows a returnable lines table (name, returned not credited, quantity to credit via `QuantityInput`, value) and a "Shipping to credit" checkbox list.
  - CORRECTION shows `correction.lines` read-only (name, quantity, amount).
  - Then the details text area (the existing `reason` field, max 500), the total, and confirm.
  - Keep the error modal, uncertain box and server field-error mapping (`lines.<j>.quantity` → `quantities.<index>`).
- Modify: translations (en / pt), under `ecommerce.orders.invoices.creditNote.`:
  - `creditType` "Reason" / "Motivo"
  - `types.RETURN` "Return" / "Devolução"
  - `types.RETURN.hint` "The credited units left the sale: they will not be invoiced again." / "As unidades creditadas saíram da venda: não voltam a ficar por faturar."
  - `types.CORRECTION` "Correction" / "Correção"
  - `types.CORRECTION.hint` "Cancels the whole invoice: its products, shipping and payments can be invoiced again in the correct invoice." / "Anula a fatura inteira: os produtos, portes e pagamentos voltam a ficar disponíveis para emitir a fatura correta."
  - `nothingReturnable` "No returned units of this invoice are left to credit." / "Não há unidades devolvidas desta fatura por creditar."
  - `columns.returnable` "Returned, not credited" / "Devolvidas por creditar"
  - `columns.quantity` "Quantity to credit" / "Quantidade a creditar"
  - `columns.value` "Value" / "Valor"
  - `shipping` "Shipping to credit" / "Portes a creditar"
  - `reason` (new value) "Details" / "Detalhes"
  - `nothing` (new value) "Choose at least one unit or shipping line to credit." / "Escolha pelo menos uma unidade ou linha de portes a creditar."

  Error codes, `ecommerce.orders.errors.` (added in Task 7, see A6; listed here for their texts):
  - `QUANTITY_EXCEEDS_CREDITABLE` "A quantity is above what can be credited. Reload the invoice." / "Uma quantidade é superior à que se pode creditar. Volte a carregar a fatura."
  - `SHIPPING_NOT_CREDITABLE` "This shipping line can no longer be credited." / "Esta linha de portes já não pode ser creditada."

  Remove `invoices.lines.creditable` if no longer used.
- Test: `tests/admin/ecommerce/invoiceForm.test.ts` (rewrite the four credit-note describes)

- [ ] **Step 1: Write the failing tests:**
  - `emptyCreditNoteForm` → `RETURN` with a returnable line of `units: 1`; `CORRECTION` when `returnable` is empty and also when every entry has `units: 0`.
  - `validateCreditNoteForm`: RETURN quantity 2 with `units: 1` → `quantities.0: exceeds_creditable`; RETURN empty → `lines: required`; CORRECTION needs only the reason; a reason of 501 characters → `too_long`.
  - `creditNoteTotal` RETURN with `{ unitsLeft: 3, valueLeft: 1000 }` and k 1, plus shipping 500 → 833. CORRECTION → `correction.total`.
  - `buildCreditNoteInput`: CORRECTION has no `lines` or `shippingIndexes`; RETURN leaves quantity 0 out.
- [ ] **Step 2: Run** `npx vitest run tests/admin/ecommerce/invoiceForm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, then the modal.
- [ ] **Step 4: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 5: Manual check** on the test project.
  - A Correção on an issued invoice: the invoices list shows the credit note, and Generate invoice offers the same products and payment again.
  - A Devolução after registering a return: only the returned units are offered.
- [ ] **Step 6: Commit** `feat(ecommerce): credit note modal with Return / Correction reason`.
- [ ] **Step 7: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 4: Documentation

### Task 10: Update the older design documents and follow-ups

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-ecommerce-design.md`:
  - **§4.4** becomes "Faturação por seleção **[Decisão, atualizada em 2026-11-14]**". It summarizes spec 1–7.1:
    - the selection of products, quantities, positive shipping lines and whole payments, with totals equal to the cent and blocked by excess;
    - the two pools and their distribution (rulings 1, 2 and 7);
    - net payments (ruling 8);
    - Moloni methods by name, created when missing;
    - the Devolução and Correção credit notes;
    - legacy invoices read as invoiced (ruling 4).

    It links to `docs/superpowers/specs/2026-11-14-invoicing-by-selection-design.md`. It keeps the bullets still true: credit notes only on request, issued invoices never change, Moloni articles by `reference = sku`. It drops the coverage snapshot, "Gerar fatura total", one SHIPPING line per VAT rate and proportional partial payments.
  - **§4.12**, last bullet: "a nota de crédito de **Devolução** credita as unidades devolvidas que já tinham sido faturadas; unidades devolvidas antes de faturar simplesmente não se faturam (2026-11-14)".
- Modify: `docs/superpowers/specs/2026-11-13-order-editing-design.md` **§8**:
  - replace the coverage bullets with a pointer to the invoicing-by-selection design. Shipping lines are invoiced individually by id (one invoice line per shipping line, with its own VAT), and a negative line only lowers the shipping value and creates excess;
  - keep "faturas emitidas nunca mudam" and "nota de crédito só a pedido do lojista";
  - in §6.1, "faturada" now means "included in a live invoice not annulled by a Correção".
- Modify: `docs/superpowers/plans/ecommerce-followups.md`:
  - mark as resolved by plan 11: the "Cobertura de pagamentos" item (line ~58), "P5 final: invoice lines can be individually off…", "Gift lines at €0 are omitted…" (now included at 0), "shipping line `invoiced` is derived from invoice dates…", "Invoice shipping VAT split…", "T1: unparseable invoice/line createdAt…" and "T6: no compose-level multi-rate invoice test…";
  - add: "Value left in the products pool with no units left to invoice (e.g. a discount removed after invoicing everything) cannot be invoiced by selection: regularize with a Correção and re-invoice".
  - add: "Moloni `paymentMethods/insert` shape built from the public docs, not verified on a live account".
- Check: `docs/ecommerce/storefront-api.md` needs no change; `grep -n -i "invoice" docs/ecommerce/storefront-api.md` shows nothing.

- [ ] **Step 1: Edit the docs** in Portuguese, in the style of the design documents, marking [Decisão] and [Escolha] as the new spec does.
- [ ] **Step 2: Run** the full suite `npx vitest run` and the three typechecks. Expected: all green.
- [ ] **Step 3: Commit** `docs(ecommerce): invoicing by selection in the design (4.4, 4.12) and order-editing §8`.
