# Invoicing Whole Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invoices take whole items. Those are whole product lines, whole shipping lines, and
whole order-level discount items. Their total equals the selected payments to the cent. Line
discounts carry no rounding remainders. Discounts reach Moloni as line discount %, applied before
VAT.

**Architecture:** A new pure module, `domain/invoiceItems.ts`, replaces the pool model's role in
selection and pricing. It works out what can still be invoiced (items), prices a selection, and
spreads the selected discounts over the selected lines. Stored invoices gain `DISCOUNT` lines and a
per-line `discountShare`. Credit notes and Moloni line pricing read them. The pool model
(`invoicingPosition`) stays for legacy reads: units invoiced and SHIPPING over-invoice. Recalculate
discounts splits lines instead of flooring.

**Tech Stack:** TypeScript, Strapi 5 plugin (server + admin React with @strapi/design-system),
vitest. Money is integer cents, VAT included.

**Spec:** `docs/superpowers/specs/2026-11-16-invoice-whole-items-design.md`

## Global Constraints

- Repo `/Users/filipemoraes/Projects/littlebox-plugins/strapi/suite`, branch `feat/ecommerce`.
- **Git:**
  - Commit with explicit paths, never `git add -A`.
  - Never touch `.yalc/` or `yalc.lock`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - After each commit run `git branch -f main HEAD`. No push.
- Modules outside e-commerce must not change.
- **Checks:**
  - `npx tsc -p server/tsconfig.json --noEmit`, the same for `admin` and `tests`;
  - `npx vitest run`.
- Never log or print customer data, credentials or tokens.
- Admin texts live in `admin/src/core/translations/en.json` and `pt.json` (key prefix
  `littlebox-strapi-suite.`), with Portuguese accents correct.
- **No partial items:** a quantity of a line or part of a value is never invoiced. Every total
  reconciles to the cent.
- Credit notes are never issued automatically.
- **Discount item ids** (strings):
  - `m:<manualDiscountId>`
  - `p:<promotionId>:<benefitIndex>` for ORDER_DISCOUNT benefits
  - `s:<promotionId>` for SHIPPING_DISCOUNT benefits
  - `adj:order` and `adj:shipping` for any unexplained difference (see Task 1)

## Review Focus

1. **Order with old pool invoices (order 23).** A line partially invoiced earlier offers its
   remaining units as one item at units × net unit. Test in Task 1.
2. **Negative shipping line** (a credit line such as −€2.60, with no `editOf`). It is a selectable
   shipping item with a negative value and never makes the total ≤ 0 unnoticed. Test in Task 2.
3. **Discount larger than the selected lines of its pool.** Refused with
   `DISCOUNT_EXCEEDS_SELECTION`. Test in Task 2.
4. **Line at €0.00 (free unit).** Takes no share of an order discount. Moloni gets 100% with no
   extra share. Test in Tasks 2 and 5.
5. **Return of one unit from a line that carried a discount share.** The credit equals the unit's
   net minus its share, and the last unit takes the remainder. Test in Task 4.

---

### Task 1: Invoiceable items (pure)

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/invoiceItems.ts`
- Modify: `server/src/services/modules/ecommerce/domain/invoicing.ts`
  - `InvoiceLine.kind` becomes `'ITEM' | 'SHIPPING' | 'DISCOUNT'`.
  - Add the optional fields `discountId?: string` and `discountShare?: number` (cents of order or
    shipping discounts spread onto this line).
  - `readInvoiceLines` keeps a `DISCOUNT` line, whose total may be negative.
- Modify: `server/src/services/modules/ecommerce/domain/invoiceSelection.ts`. The position ignores
  `DISCOUNT` lines when summing products and shipping invoiced.
- Test: `tests/server/ecommerce/domain/invoiceItems.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DiscountItem = { id: string; kind: 'ORDER' | 'SHIPPING'; label: string; amount: number; invoiced: boolean; manualKind?: 'FIXED' | 'PERCENT' | 'LEGACY'; percent?: number | null };
  export type LineItem = { orderLineId: number; units: number; value: number; invoiced: boolean };
  export type ShippingItem = { shippingLineId: number; value: number; invoiced: boolean };
  export type InvoiceItems = { lines: LineItem[]; shipping: ShippingItem[]; discounts: DiscountItem[] };
  export function discountItemsOf(order: { orderDiscount: number; shippingDiscount: number; manualDiscounts: ManualDiscount[]; applied: AppliedPromotion[] }): Omit<DiscountItem, 'invoiced'>[];
  export function invoiceItems(order: PositionOrder & { shippingDiscount: number; manualDiscounts: ManualDiscount[]; applied: AppliedPromotion[] }, docs: InvoiceDoc[]): InvoiceItems;
  ```
- **Rules:**
  - **Line:**
    - `units` = quantity − returned − units held by counted invoices, which `invoicingPosition`
      already computes (invoiced − RETURN-credited).
    - `value` = units × (unitPrice − unitDiscount).
    - `invoiced` = units === 0.
    - Gift lines are included (their value is 0 or more).
  - **Shipping:**
    - one item per line with no `editOf`;
    - `value` = its amount plus its EDIT corrections (`effectiveAmount` from `domain/shippingLines.ts`);
    - `invoiced` = in a counted, non-annulled invoice. The shipping target is the line itself, or a
      legacy target; reuse `invoicedShipping` logic.
  - **Discounts:**
    - one item per manual discount, with the label being its reason;
    - one per ORDER_DISCOUNT benefit with amount > 0;
    - one per SHIPPING_DISCOUNT benefit with amount > 0.
  - **Adjustment items:** if Σ ORDER items ≠ `orderDiscount`, add `adj:order` with the difference
    (may be negative). The same for shipping, with `adj:shipping`.
  - `invoiced` = some counted, non-annulled invoice has a `DISCOUNT` line with that `discountId`.
  - A legacy invoice (no DISCOUNT lines) folded order discounts into line totals, so no discount
    item reads as invoiced from it. Task 9 handles order 23's data.

- [ ] **Step 1: Write the failing tests** in `invoiceItems.test.ts`:
  - `a line offers all its uninvoiced units at net value`: line 3 × (3100 − 0), no docs →
    `{ units: 3, value: 9300, invoiced: false }`.
  - `a line partly invoiced by a legacy invoice offers the rest as one item`: quantity 11, an
    invoice ITEM with quantity 5 → `units 6, value 6 × net`.
  - `a shipping line with an EDIT correction is one item worth both`: amounts 500 + correction 200
    (`editOf: 1`) → `[{ shippingLineId: 1, value: 700 }]`.
  - `a negative credit line is its own item`: amount −260, no editOf → value −260.
  - `discount items: manual, ORDER promotion benefit, shipping promotion`. A manual FIXED of 1000
    with id 1, an applied promotion 5 with an ORDER_DISCOUNT benefit (index 0) of 500, and an
    applied promotion 1 with a SHIPPING_DISCOUNT benefit of 200, with `orderDiscount: 1500` and
    `shippingDiscount: 200`, give ids `['m:1', 'p:5:0', 's:1']`, amounts `[1000, 500, 200]`, and no
    `adj` items.
  - `an unexplained difference becomes an adj item`: `orderDiscount: 1501`, same items → also
    `{ id: 'adj:order', amount: 1 }`.
  - `a discount item on an invoice reads invoiced`: an invoice with a
    `{ kind: 'DISCOUNT', discountId: 'm:1', total: -1000 }` line → `invoiced: true`. When that
    invoice is annulled by a CORRECTION credit note → `false`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/invoiceItems.test.ts`. Expected:
  FAIL, because the module is missing.
- [ ] **Step 3: Implement** the types and functions above, and the `InvoiceLine` changes. Reuse
  `invoicingPosition` for the units held, and `readShippingLines` / `correctionsOf` for shipping.
- [ ] **Step 4: Run** the new test file plus `tests/server/ecommerce/domain/invoiceSelection.test.ts`
  and `invoicing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**
  (`feat(ecommerce): invoiceable whole items — lines, shipping, discount items`).

### Task 2: Price a whole-item selection and spread discounts (pure)

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/invoiceItems.ts`
- Test: `tests/server/ecommerce/domain/invoiceItems.test.ts`

**Interfaces:**
- Consumes: `InvoiceItems` (Task 1); `allocateProportionally` from `domain/orders.ts`.
- Produces:
  ```ts
  export type WholeSelectionRequest = { orderLineIds: number[]; shippingLineIds: number[]; discountIds: string[]; paymentIds: number[] };
  export type PricedWholeSelection = {
    lines: { orderLineId: number; units: number; value: number; discountShare: number }[];
    shipping: { shippingLineId: number; value: number; discountShare: number }[];
    discounts: { id: string; kind: 'ORDER' | 'SHIPPING'; amount: number }[];
    payments: { paymentId: number; value: number }[];
    total: number; paymentsTotal: number;
  };
  export function priceWholeSelection(items: InvoiceItems, payments: { id: number; net: number; available: boolean }[], request: WholeSelectionRequest): { selection: PricedWholeSelection | null; issues: ValidationIssue[] };
  ```
- **Rules:**
  - **Request issues** (path-indexed, like `priceSelection`):
    - `unknown_line`;
    - `duplicate`;
    - `LINE_ALREADY_INVOICED` (invoiced or units 0);
    - `SHIPPING_LINE_NOT_INVOICEABLE`;
    - `DISCOUNT_NOT_INVOICEABLE` (unknown or invoiced);
    - `PAYMENT_NOT_INVOICEABLE`;
    - `required` (no line, shipping or discount; no payment).
  - **Discount cap:** Σ selected ORDER discounts ≤ Σ selected line values, and Σ selected SHIPPING
    discounts ≤ Σ selected shipping values. Otherwise the issue is at `discountIds` with code
    `DISCOUNT_EXCEEDS_SELECTION`.
  - **Total:** total = Σ lines + Σ shipping − Σ discounts. It must equal paymentsTotal and be > 0.
    Otherwise `INVOICE_TOTALS_DIFFER` at `paymentIds`, only when there is no other issue.
  - **Shares:**
    - the ORDER discounts total is allocated over the selected lines with weights = line value
      (`allocateProportionally`), so a 0-value line gets 0;
    - the SHIPPING total is allocated over the selected shipping lines with positive values, with
      weights = value.
    - The shares of a pool add up exactly to its discounts.

- [ ] **Step 1: Write the failing tests:**
  - `prices lines + shipping − discounts and checks the payments`: lines 8100 and 4500, shipping
    300, discount `m:1` 1400, payment net 11500 → total 11500. The shares are lines
    `[900, 500]` and shipping `[0]`.
  - `a free line takes no share`: lines 6200 and 0, discount 620 → shares `[620, 0]`.
  - `refuses a discount above its pool`: line 500, discount 600 →
    `[{ path: 'discountIds', code: 'DISCOUNT_EXCEEDS_SELECTION' }]`.
  - `refuses an invoiced line, a duplicate and an unknown discount` (codes as above).
  - `totals must match`: payment 11499 → `INVOICE_TOTALS_DIFFER`.
  - `a negative shipping item lowers the total`: lines 1000, shipping −260, payment 740 → OK.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `priceWholeSelection`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(ecommerce): price whole-item invoice selections`).

### Task 3: Issue invoices from whole items (service, routes, order state)

**Files:**
- Modify: `server/src/services/modules/ecommerce/invoices.ts`. Touch `InvoiceSelectionView`,
  `IssueInvoiceInput`, `selection(...)` (~402-459) and `issue(...)` (~803-925).
- Modify: `server/src/services/modules/ecommerce/orders.ts`
  - `loadInvoicing` adds `items: InvoiceItems`.
  - `canIssue` = some uninvoiced line, shipping or discount item, and an available payment.
- Modify: `server/src/controllers/modules/ecommerce/invoices.ts`. Read the new body fields.
- Test: `tests/server/ecommerce/invoices.test.ts`, `tests/server/ecommerce/invoicesController.test.ts`

**Interfaces:**
- Consumes: `invoiceItems`, `priceWholeSelection` (Tasks 1-2).
- **Produces `InvoiceSelectionView`:**
  - `lines[]`: `{ orderLineId, sku, name, option, tax, isGift, units, unitPrice, unitDiscount, value }`;
  - `shipping[]`: `{ shippingLineId, name, tax, origin, createdAt, value }`;
  - `discounts[]`: `{ id, kind, label, amount, manualKind?, percent? }`;
  - `payments[]` (unchanged);
  - `excess` (unchanged);
  - `overInvoiced: { shipping }`.
  - `stranded` is removed.
- **Produces `IssueInvoiceInput`:**
  `WholeSelectionRequest & { expectedTotal: number; idempotencyKey: string }`.
- **Stored invoice lines:**
  - **ITEM:** `quantity = units`, `total = value − discountShare`,
    `grossTotal = unitPrice × units`, `discountShare`.
  - **SHIPPING:** `total = value − discountShare`, `grossTotal = value`, `discountShare`.
  - **DISCOUNT** (one per selected discount):
    `{ kind: 'DISCOUNT', orderLineId: null, sku: 'DISCOUNT', name: label, quantity: 1, total: -amount, grossTotal: -amount, tax: 0, partial: false, discountId }`.
  - The document total = Σ ITEM + Σ SHIPPING totals = the priced total. DISCOUNT lines are a
    record and are not added again.
- A request in the old shape (`lines` with quantities) is refused with
  `{ path: 'orderLineIds', code: 'required' }`.

- [ ] **Step 1: Update the failing service tests.**
  - `selection lists whole lines, shipping and discount items`. For an order with lines
    2 × 3100 and 1 × 3100 discounted 3100, shipping 300, and a manual discount 1000:
    - discounts `[{ id: 'm:1', amount: 1000 }]`;
    - line values `[6200, 0]`.
  - `issue stores ITEM/SHIPPING lines net of their share and one DISCOUNT line per discount`.
    Select both lines, the shipping and `m:1`, with payment 5500:
    - ITEM totals `[5200, 0]`, shares `[1000, 0]`;
    - one DISCOUNT line, total −1000;
    - allocation 5500.
  - `an invoiced item is never offered again`: after issuing, `selection().lines` is empty and
    `discounts` is empty.
  - Replace the quantity-based tests that assert the pool behaviour with whole-item equivalents.
    Keep legacy-read tests (old invoices still count units).
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/invoices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep idempotency, the `expectedTotal` check, allocations, `excess`
  blocking and the PENDING/UNCERTAIN handling unchanged.
- [ ] **Step 4: Run** the server suite (`npx vitest run tests/server`). Expected: PASS.
- [ ] **Step 5: Commit** (`feat(ecommerce): issue invoices from whole items`).

### Task 4: Credit notes with DISCOUNT lines and shares

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/creditNotes.ts`
- Modify: `server/src/services/modules/ecommerce/invoices.ts` (credit note preview and issue)
- Test: `tests/server/ecommerce/domain/creditNotes.test.ts`

**Interfaces:**
- Consumes: `InvoiceLine.discountShare`, `kind: 'DISCOUNT'` (Task 1).
- **Rules:**
  - A DISCOUNT line is never offered or credited alone (`creditable` 0, not returnable).
  - **CORRECTION** credits every ITEM/SHIPPING line's remaining total. DISCOUNT lines are already
    netted into those totals, so the credit note total = the invoice total minus what was
    credited, and the invoice is annulled. The credit note keeps the DISCOUNT lines as a record
    (credited value 0).
  - **RETURN** of q of a line's u remaining units, where u is the line's quantity minus the units
    already credited:
    - value = `net_unit × q − shareFor(q)`;
    - `shareFor(q)` = `floor(remainingShare × q / u)`, except when q === u, where it is
      `remainingShare`;
    - `net_unit` = grossTotal / quantity − the line's own unit discount. This equals
      `(total + discountShare) / quantity`.
    - Lines without `discountShare` (legacy) keep today's `selectedValue` rule.

- [ ] **Step 1: Write the failing tests:**
  - `RETURN of 1 of 3 units with share 1000 credits net − 333`. Line total 8300, share 1000,
    quantity 3, net_unit 3100 → credited 2767.
  - `the last unit takes the remaining share`: after crediting 2 units (666 share), the third →
    `3100 − 334`.
  - `CORRECTION credits the invoice total and never a DISCOUNT line alone`.
  - `a DISCOUNT line is not creditable`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(ecommerce): credit notes honour discount shares`).

### Task 5: Moloni — combined line discount % and line note

**Files:**
- Modify: `server/src/services/modules/ecommerce/providers/billing/moloni/linePricing.ts`
- Modify: `server/src/services/modules/ecommerce/providers/billing/moloni/provider.ts`
  - Skip DISCOUNT lines when building `products`.
  - Add `summary` to a product when the line has a note.
- Test: `tests/server/ecommerce/providers/moloniLinePricing.test.ts`, `moloniProvider.test.ts`

**Interfaces:**
- Consumes: draft lines with `grossTotal`, `total` (already net of `discountShare`),
  `discountShare`.
- **Rules:**
  - Today's per-line % from `grossTotal` vs `total` already combines both discounts. Keep the
    document-level exactness check, but **fall back per line, not for the whole document**:
    - a line whose 2-decimal % cannot reproduce its cents is sent at its discounted unit price with
      no %;
    - the other lines keep their %.
  - **Note text**, when the line has a `discountShare` > 0 or its own discount:
    - `Desconto da linha {x}% + desconto da encomenda {amount}`;
    - or only the part that exists;
    - in Portuguese, euros with a comma (`9,00 €`).
  - Before relying on `summary`, the controller confirms it with a Moloni draft (Task 9 step).
    If Moloni rejects or ignores it, put the note in the product `name` suffix instead:
    `name — note`.

- [ ] **Step 1: Write the failing tests:**
  - `combined %`: gross 10000, total 8100 → discount 19.
  - `a free line`: gross 3100, total 0 → discount 100.
  - `per-line fallback`: one line whose % cannot reproduce its cents falls back alone, and the
    other keeps its %.
  - `provider skips DISCOUNT lines and sends summary` (fake client in `moloniFake.ts`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server/ecommerce/providers`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(ecommerce): Moloni lines carry the combined discount and a note`).

### Task 6: Admin — Generate invoice with whole items

**Files:**
- Modify: `admin/src/ecommerce/orderTypes.ts` (`InvoiceSelectionView`, `IssueInvoiceInput` mirror
  Task 3)
- Modify: `admin/src/ecommerce/utils/invoiceSelection.ts`
- Modify: `admin/src/ecommerce/components/orders/IssueInvoiceModal.tsx`
- Modify: translations `en.json`, `pt.json`
- Test: `tests/admin/ecommerce/invoiceSelection.test.ts`, `invoiceForm.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type InvoiceSelectionForm = { orderLineIds: number[]; shippingLineIds: number[]; discountIds: string[]; paymentIds: number[] };
  export function defaultInvoiceSelectionForm(view: InvoiceSelectionView): InvoiceSelectionForm; // everything selected
  export function invoiceSelectionTotals(view, form): { lines: number; shipping: number; discounts: number; total: number; payments: number; difference: number };
  export function validateInvoiceSelection(view, form): FormErrors; // DISCOUNT_EXCEEDS_SELECTION, required
  export function buildIssueInvoiceInput(view, form, idempotencyKey): IssueInvoiceInput;
  ```
  Remove `selectedValue`, `unitValue`, `quantityErrorMessage` and `strandedValue`.
- **UI:**
  - **Products:** checkbox per line. Columns: Product (name, option, SKU), Qty, Unit price, Line
    discount (with its promotion name or manual % when known), Value.
  - **Shipping:** checkbox per line (name, value).
  - **Discounts:** checkbox per item. Shows the label, then "Order discount" or "Shipping
    discount", then −amount. A PERCENT manual item shows its %.
  - **Payments:** unchanged.
  - **Totals:** Products, Shipping, Discounts, Invoice total, Selected payments, Difference.
  - **Issue button:** enabled only when the difference is 0 and there are no errors.
  - Remove the quantity inputs and the stranded notice.
  - Pt texts: "Descontos", "Desconto da encomenda", "Desconto de portes", "Desconto da linha".

- [ ] **Step 1: Update the failing tests** for the new form helpers (selection of whole items,
  totals with discounts, cap error, input shape).
- [ ] **Step 2: Run** `npx vitest run tests/admin`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the modal.
- [ ] **Step 4: Run** `npx vitest run tests/admin` and the admin tsc. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(ecommerce): Generate invoice selects whole items and discounts`).

### Task 7: Recalculate discounts splits lines (no remainders)

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/discountRecalculation.ts`
  - `DiscountPricing.lines` entries gain
    `splits?: { quantity: number; unitDiscount: number; refs: BenefitRef[] }[]`.
  - `remainders` are removed.
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts` (`writeDiscountLines`, ~1639).
  A line with `splits` keeps the first split. Each further split creates a new order line
  (`orderModificationSupport.ts` create pattern) with the same variant, product, snapshot, tax and
  `manualDiscountPercent: null`, its quantity, unitDiscount and `promotionRefs: { refs }`. Stock
  does not move.
- Test: `tests/server/ecommerce/domain/discountRecalculation.test.ts`,
  `tests/server/ecommerce/orders.editDiscounts.test.ts`

**Interfaces:**
- Consumes: the combination groups (`combination.lines` with `sourceIndex`, `unitDiscount`,
  `quantity`, `refs`).
- **Rule:** group the line's combination groups by unitDiscount.
  - One group → unchanged behaviour (update unitDiscount and refs).
  - Several groups → `splits` ordered by unitDiscount ascending. The first split stays on the line.
  - No remainder is ever added to `orderDiscount`.

- [ ] **Step 1: Write the failing tests:**
  - `buy 2 get 1 on a 3-unit line splits it`: a NEW promotion BUY_X_GET_Y (buy 2, get 1 IN_CART,
    FREE) on a line of 3 × 3100 →
    `lines: [{ id, unitDiscount: 0, refs: [], splits: [{ quantity: 2, unitDiscount: 0, refs: [] }, { quantity: 1, unitDiscount: 3100, refs: [{ promotionId, benefitIndex: 0, amount: 3100 }] }] }]`,
    `orderDiscount` unchanged.
  - Update the rounding test. "100 over a set of 3" now splits per distinct unit discount
    (34 / 33), and `orderDiscount` stays at the manual 200.
  - Integration: after applying, the order has 2 lines of the variant with quantities 2 and 1, the
    total is right to the cent, and the stock is unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server`. Expected: PASS.
- [ ] **Step 5: Commit**
  (`fix(ecommerce): recalculated promotions split lines instead of leaving remainders`).

### Task 8: Products list names each line's discount

**Files:**
- Modify: `admin/src/ecommerce/components/orders/OrderLinesTable.tsx`. Lines ~120-150 already show
  `unitDiscount`.
- Modify: translations.
- Test: `tests/admin/ecommerce/` (a helper in `admin/src/ecommerce/utils/orderDetail.ts`)

**Interfaces:**
- Produces:
  `export function lineDiscountLabel(line: OrderLine, promotions: { promotionId: number; name: string; displayName?: Record<string, string> }[], locale: string): string | null`.
  - It returns the names of the line's promotions (`line.promotionIds`), joined with ", ".
  - With `manualDiscountPercent`, it returns `Desconto manual {p}%` (en: `Manual discount {p}%`).
  - It returns null when the line has no discount.
- Shown under the unit discount on lines with `unitDiscount > 0`.

- [ ] **Step 1: Write the failing test** for `lineDiscountLabel` (promotion name; manual %; none).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and render.
- [ ] **Step 4: Run** `npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 5: Commit** (`style(ecommerce): products list names the discount of each line`).

### Task 9 (controller, not a subagent): verification and order 23 data

- [ ] **Step 1: Confirm Moloni `summary`.** Run a draft probe like
  `<scratchpad>/moloni-probe/probe.js`: status 0, deleted after. Check whether `products[].summary`
  is stored. Adjust Task 5's fallback if needed.
- [ ] **Step 2: Fix order 23 with a backup script.**
  - Split line 21 (3 × 3100 with unitDiscount 1033) into 2 × 3100 (unitDiscount 0, refs `[]`) and
    1 × 3100 (unitDiscount 3100, refs promotion 6).
  - Remove the 1-cent remainder from `orderDiscount` and from `total`.
  - Recompute `paymentStatus` with `derivePaymentStatus`.
  - Write a history row.
- [ ] **Step 3: Full checks.** Run `tsc` for server, admin and tests, then `npx vitest run`.
  Rsync `dist/` to `backend-base` and restart Strapi.
- [ ] **Step 4: Browser check on order 23 (no issuing).**
  - Generate invoice lists whole lines, shipping, discounts and payments.
  - The totals reconcile.
  - Close the modal.
