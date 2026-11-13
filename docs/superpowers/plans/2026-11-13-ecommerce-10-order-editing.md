# Order Editing by Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single **Modify** modal with editing inside each section of the order screen (products, shipping address, a shipping-charges table, discounts). A change never re-prices shipping or discounts on its own: it raises a persistent review flag, and the merchant decides.

**Architecture:** Four pure domain modules hold the rules:
- `domain/shippingLines.ts`: the charges table and rule 6.2;
- `domain/orderEditing.ts`: availability and review flags;
- `domain/manualDiscounts.ts`: manual discounts;
- `domain/discountRecalculation.ts`: the 7.1 evaluation and pricing.

A new service, `EcommerceOrderEditingService` (`orderEditing.ts`), runs every edit through one idempotent runner (`operationId`, order lock, replay, recalculate). It reuses `simulateModification` for the lines and the promotion engine for discounts. The order row keeps its total columns in sync, so storefront, payments, refunds, returns and Stripe read the same fields as today. The admin replaces `ModifyOrderModal` with section buttons and modals.

**Tech Stack:** Strapi 5 plugin (TypeScript server, React admin with `@strapi/design-system` v2), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-order-editing-design.md` (binding). Also read §4.4, §4.8, §4.12 and §4.16 of `docs/superpowers/specs/2026-11-11-ecommerce-design.md`. Section numbers like "spec 6.2" below refer to the order-editing spec.

## Rulings

Ambiguities resolved here (decision: why). They follow the spec's [Decisão] points and settle its [Escolha] and "ao builder" points.

1. **Storage.** Three new JSON attributes on the order:
   - `shippingLines: { lines: ShippingLine[] }`;
   - `manualDiscounts: { items: ManualDiscount[] }`;
   - `reviewFlags: { flags: ReviewFlag[] }`.

   Why: JSON columns hold objects only (MariaDB rule from plan 9). The existing columns stay authoritative for every other reader (`shippingOriginal`, `shippingDiscount`, `shippingTotal`, `shippingMethod`, `shippingTax`, `orderDiscount`, `total`), and every edit rewrites them.
2. **Migration (spec 6.1, 7.4).** Two parts:
   - **Read-through.** Each reader (`readShippingLines`, `readManualDiscounts`, `readReviewFlags`) builds the legacy value when the column is `null`, with the pure `legacyEditingData`. Ids are stable: the CHECKOUT line is id `1`, the legacy discount is id `1`. Every edit persists what it read.
   - **Backfill.** A bootstrap backfill (`migrateOrderEditingData`) writes the same data, in batches of 100.

   Why: the plugin has no migration framework (the existing code reads legacy shapes leniently, e.g. `appliedOf`). If the backfill fails, the read-through still gives correct data.
3. **"Envio" means an `ACTIVE` shipment.** `FAILED` and `CANCELLED` shipments shipped nothing. A `PENDING` shipment blocks all editing (spec 2). This applies to spec 2 ("nenhum envio") and 6.1 ("gasta"). Why: it matches `previousShipmentsCost`, which counts only ACTIVE shipments.
4. **A shipping line is "faturada"** when some invoice row of kind `INVOICE` meets both conditions:
   - its status is `ISSUED`, `PENDING` or `UNCERTAIN`;
   - it has a `SHIPPING` line and was created at or after the shipping line's `createdAt`.

   Why: prudence (spec 2 counts `UNCERTAIN` as issued), and it needs no change to how coverages are stored.
5. **Coverage keeps one aggregate shipping slot** (`PaymentCoverage.shipping.value`), so reconciliation and credit notes stay as they are. Two things are derived instead:
   - per-line "paid": covered shipping consumed oldest-first by positive lines;
   - invoice VAT split: one `SHIPPING` invoice line per VAT rate, the covered value split in proportion to `max(0, Σ amounts at that rate)` (spec 8).

   Why: value-based coverage already gives spec 8's behaviour. A negative line lowers `shippingTotal`, so it only creates excess and never enters an invoice.
6. **Recalculate shipping (spec 6.3).**
   - `due = previousShipmentsCost(shipments) + quote`, where `quote` prices the current method for the units not yet reserved (`quantity − reserved`), at the current address. If no unit is pending, `quote = 0` and no carrier is called.
   - `due === charged` → nothing changes and the flag clears.
   - Otherwise the new table is the locked lines (spent or invoiced) plus one `RECALCULATION` line of `due − Σ locked`. That line is left out when the amount is 0 and locked lines exist.
   - With no locked lines, the table becomes one `RECALCULATION` line with amount `due`.
7. **Edit and Add a shipping line (spec 6.2, 6.3).**
   - A replaceable line (not spent, not invoiced) is replaced in place: origin `EDIT`, new method and amount.
   - Otherwise Edit appends an `EDIT` line with the new method and the signed difference.
   - Add always appends a `MANUAL` line.
   - Amounts are integers in `0..MAX_MONEY_CENTS`.
   - The method must be one of `shippingOptionsForOrder` (the pending units, or all effective units when none is pending, at the current address), else `SHIPPING_METHOD_UNAVAILABLE`.
8. **Sync after any change to the shipping lines.** `shippingOriginal = Σ lines`, `shippingDiscount = min(stored, Σ lines)` (spec 6.3: the euro value is kept), `shippingTotal = difference`. `shippingMethod` gets the current method with `price = Σ lines`, and `shippingTax` gets its tax.
9. **The modification endpoints are removed** (`/:id/modification/preview`, `/:id/modification`), together with `previewModification`, `applyModification`, `normalizeModification`, `resolveShipping` and `writeModification` in `orders.ts`. `simulateModification` stays and is called with `shipping: { mode: 'KEEP' }` and no `orderDiscount`. The products save writes one `LINES_CHANGED` history entry, not one entry per line (spec 4, 9).
10. **One idempotent runner** for all edits. The main history row of each edit has `uniqueKey = edit:<operationId>` and `newValue.kind`. Reusing an `operationId` for another kind, or on another order, gives `OPERATION_ID_CONFLICT`. Stock keys are `edit:<operationId>:<variantId>`.
11. **Error codes.**
    - New `409` codes in `CONFLICT_CODES`: `ORDER_NOT_EDITABLE` (`detail`: `CANCELLED` | `ARCHIVED` | `SHIPMENT_PENDING`), `ORDER_HAS_SHIPMENTS`, `REVIEW_FLAG_NOT_DISMISSABLE`, `PROMOTIONS_NOT_COMBINABLE`, `PROMOTION_GIFT_SHIPPED`.
    - `400` codes: `COUNTRY_NOT_SERVED`, `SHIPPING_METHOD_UNAVAILABLE`, `SHIPPING_QUOTE_FAILED` (existing), `DISCOUNT_EXCEEDS_PRODUCTS`, `SHIPPING_LINE_NOT_FOUND`, `MANUAL_DISCOUNT_NOT_FOUND`, and the line codes of `simulateModification`.
12. **Candidates for spec 7.1.**
    - Load with `loadCandidates({ codes, email })`, trusted (admin). `codes` = the codes entered at checkout (`promotions.codes[].code`) plus the codes of applied CODE promotions.
    - For each promotion with a `RESERVED` redemption on this order, subtract 1 from `redemptions` and from `customerUses` (minimum 0). Otherwise the order's own use would block it.
    - Gifts are evaluated with an empty map. A gift-only promotion is never offered as "Nova"; the merchant adds the product in Products and an `IN_CART` promotion then applies.
13. **Classifying applied promotions (spec 7.1).**
    - "Ainda válida": the promotion is in `evaluation.eligible`, i.e. not blocked and its conditions are met (`CONFLICT`/`NO_BENEFIT` still count as valid).
    - "Já não válida": anything else. The reason is the evaluation's rejection reason, or `NOT_FOUND` when the promotion was deleted.
    - "Nova": a promotion in `evaluation.applied` that the order has not applied.
14. **Pricing a selection (spec 7.1).**
    - The selected valid and new candidates go through `applyCombination` over the customer lines (non-gift, effective quantity > 0, not frozen), with `shipping = Σ shipping lines`.
    - A line is frozen when its `promotionRefs` name a kept-but-invalid promotion. Frozen lines keep their `unitDiscount` and refs.
    - Each priced line's discount `D` (Σ `unitDiscount × quantity` over its groups) is stored as `unitDiscount = floor(D / q)`. The remainders `D − unitDiscount × q` are added to the order discount, so totals are exact and no order line is split. Why: lines with shipments, returns and coverage keep their ids.
    - New order discount = combination order discount + the stored ORDER amounts of kept-invalid promotions + kept manual amounts + remainders. It is clamped by `computeTotals`.
    - Shipping discount = `min(gross, combination shipping + stored SHIPPING amounts of kept-invalid promotions)`.
    - Kept-invalid promotions keep their stored `AppliedPromotion` entry. Valid and new ones get a fresh entry (current version and snapshot, recalculated amounts).
15. **Stacking check (spec 7.1).** For every pair of selected promotions, `compatible()` must hold; kept-invalid ones use their snapshot's `stacking` and `classes`. Each failing pair goes into `conflicts`, and confirming with conflicts gives `PROMOTIONS_NOT_COMBINABLE`.
16. **Gift lines.** Deselecting a promotion removes its gift lines that have nothing shipped: they are deleted (or set to quantity 0 when units were returned), with an `ORDER_RESTOCK` move. If any of its gift units were shipped, the row is `locked: 'GIFT_SHIPPED'` and confirming without it gives `PROMOTION_GIFT_SHIPPED`.
17. **Usage counts.** Newly selected promotions are reserved with `reserve`, which now takes back a `RELEASED` redemption of the same promotion and order. Deselected promotions go through the new `releasePromotions(orderId, ids)`. Kept promotions are not touched.
18. **Manual discounts (spec 7.2).**
    - `kind: 'FIXED' | 'PERCENT'`. The base is the current `subtotal`, after product discounts and before order discounts. `percent` is in (0, 100] with at most 2 decimals, and `amount = percentOf(subtotal, percent)`. A FIXED amount is in 1..`MAX_MONEY_CENTS`.
    - `reason` is required, 1–200 characters after trimming. It is never logged.
    - `amount > subtotal − orderDiscount` → `DISCOUNT_EXCEEDS_PRODUCTS`.
    - `orderDiscount` remains the order's total order-level discount (promotions + manual). The manual items are listed separately; the promotions' part is the rest.
19. **Legacy manual discount (spec 7.4).** `amount = max(0, orderDiscount − Σ amounts of applied ORDER_DISCOUNT benefits)`, `kind: 'LEGACY'`, `reason: 'Previous manual adjustment'`. The admin shows it translated ("Ajuste manual anterior").
20. **Products save and flags (spec 3, 4).** The shipping due after the change is quoted before the transaction, as `resolveShipping` did. A failed quote raises `SHIPPING_REVIEW` with reason `SHIPPING_QUOTE_FAILED` and never blocks the save. `DISCOUNTS_REVIEW` is raised when `unmet()` is not empty, or the evaluation (ruling 12) would apply a promotion the order does not have.
21. **Address (spec 5).** Only the shipping address can change. Allowed countries = the countries the current method serves ∩ the store markets (`servedCountries`), else `COUNTRY_NOT_SERVED`. The save re-quotes the current method for the whole order: a different price, or a failed quote, raises `SHIPPING_REVIEW` (reason `ADDRESS_CHANGED` or `SHIPPING_QUOTE_FAILED`).
22. **A shipping change raises `DISCOUNTS_REVIEW`** (reason `SHIPPING_CHANGED`) when the gross shipping changed and the order has a shipping discount (`shippingDiscount > 0`, or an applied promotion with class `SHIPPING_DISCOUNT`).
23. **Fully shipped orders stay editable** ([Decisão] spec 2), so spec 3's "já não é possível recalcular" applies only to `CANCELLED`, `ARCHIVED` and `SHIPMENT_PENDING`. A flag can be dismissed only then.
24. **Result step.** Every modal that changes money ends on a result step (`BalanceOutcome`) when the outcome is `DUE` or `REFUNDABLE`. It shows the new balance with Refund / Add payment / Send payment instructions, which open the top-bar modals. This replaces `SupplementaryPaymentModal`.
25. **Permissions.** Every edit route uses `orders.manage`, including the two GETs that quote (`shipping-address/countries`, `shipping-options`).
26. **Events.** Each edit emits `ORDER_MODIFIED` with `{ kind, outcome, difference }`. No listener sends e-mail (unchanged).

## Global Constraints

- Modules other than e-commerce must not change, except the one bootstrap call in `server/src/bootstrap.ts` (ruling 2). Single tenant.
- The storefront API contract is unchanged (`docs/ecommerce/storefront-api.md` shapes). `shippingTotal` and the other totals stay the totals.
- Never print secrets. Moloni descriptions, customer values and manual-discount reasons never go into logs.
- No automatic e-mails to the shopper. No automatic refunds, credit notes or store credit.
- Invoices already issued never change. Shipping already spent is never rewritten: corrections are new lines (spec 6.2).
- The server enforces every availability rule of spec 2; the UI only hides buttons.
- Any Strapi DB: no `@strapi/utils` imports. JSON columns hold objects only. Money is integer cents with VAT included, capped at `MAX_MONEY_CENTS`.
- Admin UI conventions already in use:
  - `components/orders/EmptyNote.tsx` for empty states;
  - `components/ColumnLabel.tsx` for right-aligned Actions headings;
  - `ToneBadge`/`Pill` in `components/orders/StatusBadges.tsx`;
  - `OrderSection` with its `actions` prop for top-right section buttons;
  - `HeaderActions` for the top bar;
  - the Actions column is hidden when no row has an action.
- All new texts go in `admin/src/core/translations/en.json` and `pt.json`, with keys prefixed `littlebox-strapi-suite.` and pt with correct accents. Keys removed from the code are removed from both files.
- Every task:
  - typecheck with `npx tsc -p server/tsconfig.json --noEmit`, `npx tsc -p admin/tsconfig.json --noEmit` and `npx tsc -p tests/tsconfig.json --noEmit`;
  - run its tests with `npx vitest run <paths>`;
  - at the end of each phase, run the full suite with `npx vitest run`.
- Git:
  - commit with explicit paths, never `git add -A`;
  - never touch `.yalc/` or `yalc.lock`;
  - commit message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - after each commit run `git branch -f main HEAD`;
  - no push.

## Review Focus

1. **The order's own redemption counts against usage limits.** Take a promotion with `perCustomerLimit: 1` (or `usageLimit` reached by this order). After Recalculate discounts, it must still be "Aplicada e ainda válida" with its recalculated value, not "já não válida (CUSTOMER_LIMIT_REACHED)". Pinned in Task 11.
2. **Adding products to a FULFILLED order.** Lowering or removing a shipped line is refused (`QUANTITY_BELOW_SHIPPED`). Adding a line moves `fulfillmentStatus` to `PARTIALLY_FULFILLED`, brings back `SHIP` and removes `ARCHIVE`. Pinned in Task 8.
3. **A legacy order edited before the backfill ran** (`shippingLines` null, `orderDiscount` above the promotions' ORDER amount). The view shows CHECKOUT line `1` and a LEGACY manual discount. The first edit persists both. Reading never changes the totals. Pinned in Tasks 5 and 7.
4. **Reusing an `operationId`.** Sent again for another edit kind, or on another order: `OPERATION_ID_CONFLICT`, never the other edit's replayed outcome. Sent twice for the same edit: applied once. Pinned in Task 7.
5. **A carrier quote that fails during a products or address save.** The save succeeds and `SHIPPING_REVIEW` is raised with reason `SHIPPING_QUOTE_FAILED`. A failing Recalculate shipping changes nothing and answers `SHIPPING_QUOTE_FAILED`. Pinned in Tasks 8, 9 and 10.

---

## Phase 1: Domain rules and data model

### Task 1: Shipping lines domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/shippingLines.ts`
- Test: `tests/server/ecommerce/domain/shippingLines.test.ts`

**Interfaces:**
- Produces:
  - `export type ShippingLineOrigin = 'CHECKOUT' | 'RECALCULATION' | 'EDIT' | 'MANUAL'`
  - `export type ShippingMethodRef = { providerId: string; serviceId: string; name: string; tax: number }`
  - `export type ShippingLine = ShippingMethodRef & { id: number; origin: ShippingLineOrigin; amount: number; createdAt: string; actor: string }`. `amount` is signed cents.
  - `export type ShippingLineView = ShippingLine & { paid: boolean; invoiced: boolean; spent: boolean }`
  - `export function checkoutLine(order: { createdAt: string; shippingOriginal: unknown; shippingTax: unknown; shippingMethod: unknown }): ShippingLine` (id 1, actor `system`)
  - `export function readShippingLines(order: { shippingLines?: unknown } & Parameters<typeof checkoutLine>[0]): ShippingLine[]` (`null`/malformed → `[checkoutLine(order)]`; malformed entries dropped; sorted by id)
  - `export function chargedShipping(lines: ShippingLine[]): number`
  - `export function currentMethod(lines: ShippingLine[]): ShippingMethodRef | null` (latest line whose origin is not `RECALCULATION`, else the latest line)
  - `export function nextShippingLineId(lines: ShippingLine[]): number`
  - `export function shippingLineViews(lines: ShippingLine[], ctx: { coveredShipping: number; invoices: { kind: string; status: string; createdAt: string; hasShipping: boolean }[]; hasActiveShipment: boolean }): ShippingLineView[]`
  - `export const isReplaceable = (l: ShippingLineView): boolean => !l.spent && !l.invoiced`
  - `export function planLineChange(lines: ShippingLineView[], targetId: number, next: { method: ShippingMethodRef; amount: number }, meta: { at: string; actor: string }): { lines: ShippingLine[]; mode: 'REPLACED' | 'APPENDED' | 'UNCHANGED' }` (ruling 7; throws nothing, unknown `targetId` → `UNCHANGED`)
  - `export function appendLine(lines: ShippingLine[], line: Omit<ShippingLine, 'id'>): ShippingLine[]`
  - `export function planRecalculation(lines: ShippingLineView[], due: number, meta: { method: ShippingMethodRef; at: string; actor: string }): { lines: ShippingLine[]; mode: 'REPLACED' | 'APPENDED' | 'UNCHANGED'; charged: number; delta: number }` (ruling 6)
  - `export function shippingTaxRates(lines: ShippingLine[]): { tax: number; weight: number; name: string }[]` (per distinct tax: `weight = max(0, Σ amount)`; `name` = the latest line's name at that rate; sorted by tax descending)

- [ ] **Step 1: Write the failing tests:**
  - `checkoutLine({ createdAt: '2026-11-01T10:00:00.000Z', shippingOriginal: 500, shippingTax: 23, shippingMethod: { providerId: 'manual', serviceId: '1', name: 'Courier' } })` → `{ id: 1, origin: 'CHECKOUT', amount: 500, tax: 23, providerId: 'manual', serviceId: '1', name: 'Courier', createdAt: '2026-11-01T10:00:00.000Z', actor: 'system' }`.
  - `readShippingLines` with `shippingLines: null` → that one line. With `{ lines: [valid, { id: 'x' }] }` → only the valid one.
  - `chargedShipping([500, -200, 300])` → 600.
  - `currentMethod`: CHECKOUT(A), RECALCULATION(A), MANUAL(B), RECALCULATION(B) → B. A table with only RECALCULATION(A) → A.
  - `shippingLineViews` paid FIFO: lines 500, 300 with `coveredShipping: 600` → `paid` = `[true, false]`. A negative line is `paid: false`.
  - `invoiced`: an `INVOICE`/`UNCERTAIN` invoice with shipping, created after line 1 and before line 2 → `[true, false]`. A `CREDIT_NOTE` never counts. A `FAILED` invoice never counts.
  - `spent` = `hasActiveShipment` for every line.
  - `planLineChange` on a replaceable line 1 (500 → method B, 700) → one line `{ id: 1, origin: 'EDIT', amount: 700, providerId: B }`, mode `REPLACED`.
  - `planLineChange` on an invoiced line → lines `[line1, { id: 2, origin: 'EDIT', amount: 200, providerId: B }]`, mode `APPENDED`. Same method and same amount → `UNCHANGED`.
  - `planRecalculation`, no locked line, two lines 500 + 300, due 650 → `[{ id: 3, origin: 'RECALCULATION', amount: 650 }]`, `REPLACED`, `delta: -150`.
  - `planRecalculation`, all spent, charged 500, due 350 → appends `-150`, `APPENDED`.
  - `planRecalculation` with due = charged → `UNCHANGED`, lines identical.
  - `planRecalculation`, locked 500 + replaceable 300, due 500 → `[locked]` only (the 0-amount line is left out), `REPLACED`.
  - `shippingTaxRates([{ tax: 23, amount: 500 }, { tax: 6, amount: 100 }, { tax: 23, amount: -600 }])` → `[{ tax: 23, weight: 0 }, { tax: 6, weight: 100 }]` (names included).

- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/shippingLines.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `shippingLines.ts` (no Strapi imports). Use `num`-style finite coercion for stored values.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): shipping lines domain (charges table, replace-or-append rule)`.

---

### Task 2: Editability and review flags domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/orderEditing.ts`
- Test: `tests/server/ecommerce/domain/orderEditing.test.ts`

**Interfaces:**
- Produces:
  - `export type OrderEditAction = 'ADD_PRODUCTS' | 'EDIT_ADDRESS' | 'RECALCULATE_SHIPPING' | 'EDIT_SHIPPING_LINE' | 'ADD_SHIPPING_LINE' | 'RECALCULATE_DISCOUNTS' | 'ADD_DISCOUNT' | 'REMOVE_DISCOUNT'`
  - `export type EditBlockReason = 'CANCELLED' | 'ARCHIVED' | 'SHIPMENT_PENDING'`
  - `export type OrderEditing = { editable: boolean; blockedBy: EditBlockReason | null; hasShipments: boolean; actions: OrderEditAction[] }`
  - `export function orderEditing(input: { orderStatus: OrderStatus; hasPendingShipment: boolean; hasActiveShipment: boolean }): OrderEditing`. `EDIT_ADDRESS` and `EDIT_SHIPPING_LINE` are only offered without an active shipment. The actions come in the order of the type.
  - `export type ReviewFlagCode = 'SHIPPING_REVIEW' | 'DISCOUNTS_REVIEW'`
  - `export type ReviewReason = 'PRODUCTS_CHANGED' | 'ADDRESS_CHANGED' | 'SHIPPING_CHANGED' | 'SHIPPING_QUOTE_FAILED'`
  - `export type ReviewFlag = { code: ReviewFlagCode; reason: ReviewReason; raisedAt: string; actor: string }`
  - `export function readReviewFlags(stored: unknown): ReviewFlag[]` (null → `[]`)
  - `export function raiseFlag(flags: ReviewFlag[], flag: ReviewFlag): ReviewFlag[]` (replaces the same code)
  - `export function clearFlag(flags: ReviewFlag[], code: ReviewFlagCode): { flags: ReviewFlag[]; cleared: boolean }`

- [ ] **Step 1: Write the failing tests:**
  - Each `orderEditing` case returns exactly these `actions`:
    - `OPEN`, no shipments → all 8 actions;
    - `OPEN` with an active shipment → without `EDIT_ADDRESS` and `EDIT_SHIPPING_LINE`; `hasShipments: true`;
    - a pending shipment → `editable: false`, `blockedBy: 'SHIPMENT_PENDING'`, `actions: []`;
    - `CANCELLED` → `blockedBy: 'CANCELLED'`;
    - `ARCHIVED` → `blockedBy: 'ARCHIVED'`.
  - `raiseFlag` on a raised `SHIPPING_REVIEW` replaces its reason and date and keeps one entry. `clearFlag` on an absent code → `cleared: false`.
  - `readReviewFlags({ flags: [{ code: 'X' }] })` → `[]`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/orderEditing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the domain module. `MODIFY` is removed in Task 7, together with the code that uses it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): order editability rules and review flags domain`.

---

### Task 3: Manual discounts domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/manualDiscounts.ts`
- Test: `tests/server/ecommerce/domain/manualDiscounts.test.ts`

**Interfaces:**
- Produces:
  - `export type ManualDiscount = { id: number; kind: 'FIXED' | 'PERCENT' | 'LEGACY'; percent: number | null; amount: number; reason: string; createdAt: string; actor: string }`
  - `export const LEGACY_DISCOUNT_REASON = 'Previous manual adjustment'`
  - `export const MAX_DISCOUNT_REASON = 200`
  - `export function legacyManualDiscount(order: { createdAt: string; orderDiscount: unknown; promotions: unknown }): ManualDiscount | null` (ruling 19; id 1, actor `system`; null when the amount is 0)
  - `export function readManualDiscounts(order: { manualDiscounts?: unknown } & Parameters<typeof legacyManualDiscount>[0]): ManualDiscount[]` (null column → the legacy item or `[]`)
  - `export function manualDiscountTotal(items: ManualDiscount[]): number`
  - `export function buildManualDiscount(input: unknown, ctx: { subtotal: number; orderDiscount: number; nextId: number; at: string; actor: string }): { discount: ManualDiscount | null; errors: { path: string; code: string }[] }`
    - `kind` must be `FIXED` or `PERCENT`, else `{ path: 'kind', code: 'required' }`;
    - `value`: cents for FIXED, percent for PERCENT, else `{ path: 'value', code: 'INVALID_AMOUNT' }`;
    - `reason` must be 1..200 characters, else `{ path: 'reason', code: 'required' }`;
    - an amount that does not fit → `{ path: 'value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }`.

- [ ] **Step 1: Write the failing tests:**
  - `legacyManualDiscount` with `orderDiscount: 1500` and an applied ORDER_FIXED benefit of 1000 → amount 500, kind `LEGACY`, reason `LEGACY_DISCOUNT_REASON`. With `orderDiscount: 800` → null. With `promotions: []` (legacy) and `orderDiscount: 300` → 300.
  - FIXED: `buildManualDiscount({ kind: 'FIXED', value: 500, reason: ' Goodwill ' }, { subtotal: 4000, orderDiscount: 0, … })` → amount 500, reason `'Goodwill'`, `percent: null`.
  - PERCENT: `{ kind: 'PERCENT', value: 10 }` on subtotal 5000 → amount 500, `percent: 10`. `value: 12.345` → `INVALID_AMOUNT`. `value: 0` or `101` → `INVALID_AMOUNT`.
  - `value: 3600` with `subtotal: 4000, orderDiscount: 500` → `DISCOUNT_EXCEEDS_PRODUCTS`.
  - Empty reason, or 201 characters → `reason`/`required`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/manualDiscounts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `percentOf` from `domain/promotions`. Read applied promotions the way `appliedOf` does (`{ applied }` record, legacy `[]` = none).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): manual order discounts domain`.

---

### Task 4: Discount recalculation domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/discountRecalculation.ts`
- Test: `tests/server/ecommerce/domain/discountRecalculation.test.ts`

**Interfaces:**
- Consumes: `evaluatePromotions`, `applyCombination`, `compatible`, `classesOf`, `BENEFIT_CLASS`, `normalizePromotionCode` (domain/promotions); `computeTotals`, `financialSummary` (domain/orders); `ModificationTotals` (domain/orderModification); `ManualDiscount` (Task 3).
- Produces:
  - ```ts
    export type DiscountLine = LineAmounts & {
      id: number; variantId: number; productId: number; isGift: boolean; shipped: number;
      refs: BenefitRef[];
    };
    export type DiscountContext = {
      lines: DiscountLine[]; applied: AppliedPromotion[]; manual: ManualDiscount[];
      orderDiscount: number; shippingGross: number; shippingDiscount: number;
      email: string | null; codes: string[]; candidates: PromotionCandidate[];
      now: Date; searchLimit: number; payments: PaymentLike[]; refunds: RefundLike[];
    };
    export type DiscountRow = {
      key: string;                       // `p:<promotionId>` | `m:<manualId>`
      kind: 'APPLIED_VALID' | 'APPLIED_INVALID' | 'NEW' | 'MANUAL';
      promotionId: number | null; manualId: number | null;
      name: string; displayName: Record<string, string>; code: string | null;
      method: 'AUTOMATIC' | 'CODE' | 'MANUAL'; classes: DiscountClass[];
      currentAmount: number | null;      // stored amount (applied, manual); null for NEW
      amount: number;                    // value under the priced selection
      invalidReason: RejectionReason | 'NOT_FOUND' | null;
      selected: boolean;                 // initial selection
      locked: 'GIFT_SHIPPED' | null;
    };
    export type DiscountPricing = {
      lines: { id: number; unitDiscount: number; refs: BenefitRef[] }[];  // changed lines only
      removedGiftLines: { id: number; variantId: number; quantity: number }[];
      applied: AppliedPromotion[]; manual: ManualDiscount[];
      orderDiscount: number; shippingDiscount: number;
      before: ModificationTotals; after: ModificationTotals;
      conflicts: [string, string][];
      added: number[]; removed: number[];  // promotion ids
    };
    export type DiscountRecalculation = { rows: DiscountRow[]; selection: string[]; exhaustive: boolean } & DiscountPricing;
    ```
  - `export function recalculateDiscounts(ctx: DiscountContext, selection?: string[]): DiscountRecalculation`. Without `selection`, the initial selection of spec 7.1 is used. Unknown keys in `selection` are ignored. `rows[].amount` reflects the priced selection. A locked row is always selected.

- [ ] **Step 1: Write the failing tests.** Build the candidates with the existing `tests/server/ecommerce/domain/promotions` fixtures style.
  - **Valid:** an applied ORDER_PERCENT 10 % on 2 × 2000 → row `APPLIED_VALID`, `currentAmount: 400`. After adding a third unit (lines quantity 3), `amount: 600` and `after.orderDiscount === 600`.
  - **Invalid kept:** an applied promotion whose candidate is now `active: false` → `APPLIED_INVALID`, `invalidReason: 'INACTIVE'`, selected. It is priced at its stored amount and its frozen line keeps its `unitDiscount`. A deleted promotion → `NOT_FOUND`. Deselecting it → `removed: [id]` and the discount goes.
  - **New:** an automatic promotion that now applies → `NEW`, `selected: false`, `amount` = the value it would give. Selecting it → `added: [id]`, and `applied` contains a fresh entry for it.
  - **Manual:** a FIXED 500 manual → a `MANUAL` row, selected. Deselecting it removes it from `manual` and lowers `orderDiscount` by 500.
  - **Exclusive conflict:** selecting an exclusive NEW promotion together with a kept valid one → `conflicts: [['p:1','p:2']]`.
  - **Rounding:** a PRODUCT_FIXED of 100 per SET of 3 on a line of quantity 2, for a line discount that does not divide: the remainder goes to `orderDiscount`. `after.total` equals the combination total minus the kept amounts, exact to the cent.
  - **Shipping promotion:** SHIPPING_FREE with `shippingGross: 700` → `shippingDiscount: 700`.
  - **Gift lines:** deselecting a promotion that owns an unshipped gift line → `removedGiftLines` has it. With the gift `shipped: 1`, the row is `locked: 'GIFT_SHIPPED'` and stays selected even when `selection` omits it.
  - **Before/after:** `before` equals `computeTotals` of the stored state; `due`/`excess` come from `financialSummary`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/discountRecalculation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with rulings 12–16. The evaluation lines are the non-gift lines with `quantity − returnedQuantity > 0`; `shipping` is `shippingGross`; `gifts` is `new Map()`. Pricing:
  1. Frozen lines are the lines whose refs name an `APPLIED_INVALID` promotion that stays selected.
  2. Run `applyCombination(selectedValidAndNew, { lines: nonFrozen, shipping: shippingGross, gifts: new Map(), giftChoices: {} })`.
  3. For each non-frozen line, sum its priced groups by `sourceIndex` → `D`; store `unitDiscount = floor(D / q)`; add the remainder to the order discount. The line refs are the groups' refs.
  4. Assemble `orderDiscount` and `shippingDiscount` as in ruling 14.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): discount recalculation domain (classify, price a selection)`.

---

### Task 5: Order attributes, creation and legacy backfill

**Files:**
- Modify: `server/src/content-types/modules/ecommerce/order/schema.json`. Add `"shippingLines": { "type": "json" }`, `"manualDiscounts": { "type": "json" }` and `"reviewFlags": { "type": "json" }`, with no defaults, so existing rows read `null`.
- Create: `server/src/services/modules/ecommerce/domain/orderEditingData.ts`
  - `export function legacyEditingData(order: any): { shippingLines: { lines: ShippingLine[] }; manualDiscounts: { items: ManualDiscount[] }; reviewFlags: { flags: ReviewFlag[] } }`
- Create: `server/src/services/modules/ecommerce/orderEditingMigration.ts`
  - `export async function migrateOrderEditingData(strapi: Core.Strapi, batchSize = 100): Promise<{ migrated: number }>`: selects orders `where: { shippingLines: { $null: true } }`, in id order, by batch; updates only `shippingLines`, `manualDiscounts` and `reviewFlags`.
- Modify: `server/src/bootstrap.ts`. After `registerEcommercePermissions`, add `try { await migrateOrderEditingData(strapi) } catch (e) { strapi.log?.warn?.('[ecommerce] order editing migration failed: ' + (e instanceof Error ? e.name : typeof e)) }`.
- Modify: `server/src/services/modules/ecommerce/orders.ts` (`create`). The new order is written with:
  - `shippingLines: { lines: [checkoutLine({ createdAt: <now ISO>, shippingOriginal, shippingTax, shippingMethod })] }`;
  - `manualDiscounts: { items: [] }`;
  - `reviewFlags: { flags: [] }`.
- Test: `tests/server/ecommerce/ordersContentTypes.test.ts` (attribute list), `tests/server/ecommerce/orderEditingMigration.test.ts`, `tests/server/ecommerce/orders.create.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the three columns, always objects after create. `legacyEditingData` is used by the readers in Task 7.

- [ ] **Step 1: Write the failing tests:**
  - The content-type test lists the three attributes, with type `json`.
  - A created order stores one CHECKOUT line with amount 500, `manualDiscounts.items: []` and `reviewFlags.flags: []`.
  - **Migration:** two legacy orders (null columns), one of them with `orderDiscount` above its promotions' ORDER amount. After `migrateOrderEditingData`:
    - both have the CHECKOUT line;
    - the second has a LEGACY item;
    - no other column changed (compare rows before and after, minus the three keys);
    - a second run → `{ migrated: 0 }`.
  - With `batchSize: 1` and 3 orders → all 3 migrated.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/ordersContentTypes.test.ts tests/server/ecommerce/orderEditingMigration.test.ts tests/server/ecommerce/orders.create.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): order shipping lines, manual discounts and review flags storage`.

---

### Task 6: Invoice shipping lines per VAT rate

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/invoicing.ts`. `buildInvoiceLines(coverages, order, shipping: { reference: string; rates: { tax: number; weight: number; name: string }[] })` splits the covered shipping value with `allocateProportionally(shippingValue, rates.map(r => r.weight))` and emits one `SHIPPING` line per rate with value > 0. `partial` is `shippingValue !== shippingDue` on each line. When every weight is 0 and `shippingValue > 0`, it emits one line at `rates[0]` (or tax 0 when `rates` is empty).
- Modify: `server/src/services/modules/ecommerce/invoices.ts` (`compose`): `rates: shippingTaxRates(readShippingLines(order))`. A rate's name falls back to `'Shipping'`.
- Test: `tests/server/ecommerce/domain/invoicing.test.ts`, `tests/server/ecommerce/invoices.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - Rates `[{ tax: 23, weight: 400 }, { tax: 6, weight: 100 }]`:
    - covered shipping 500 → two SHIPPING lines, `400@23` and `100@6`;
    - covered 250 → `200@23` and `50@6`.
  - A single rate → one line, the same as before (existing assertions migrated to the new parameter).
  - An order whose lines are 500 (CHECKOUT) and −200 (RECALCULATION), invoiced after paying 300: one SHIPPING line of 300; no invoice line is ever negative.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/domain/invoicing.test.ts tests/server/ecommerce/invoices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): one invoice shipping line per VAT rate`.
- [ ] **Step 6: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 2: Server services and endpoints

### Task 7: Editing service skeleton, runner and order view

**Files:**
- Create: `server/src/services/modules/ecommerce/orderEditing.ts` (`EcommerceOrderEditingService`)
- Modify: `server/src/services/index.ts` (register it)
- Modify: `server/src/services/modules/ecommerce/domain/orders.ts`: remove `'MODIFY'` from `OrderActionKey` and from `availableActions`, and update the doc comment's action order.
- Modify: `server/src/services/modules/ecommerce/orders.ts`:
  - delete the modification block (ruling 9) and the `'MODIFY'` filter;
  - add `loadCatalog` to the returned object;
  - `OrderView` gains `editing: OrderEditing`, `shippingLines: ShippingLineView[]`, `manualDiscounts: ManualDiscount[]` and `reviewFlags: ReviewFlag[]`;
  - `OrderState` gains `editing: OrderEditing` and `shippingLines: ShippingLineView[]`, computed in `computeOrderState`.
  - `coveredShipping` = Σ `invoicing.reconciled.get(id)?.shipping`.
  - The invoices for `shippingLineViews` come from `invoicing.invoices`, with `hasShipping` from `lines.lines[].kind === 'SHIPPING'`.
- Modify: `server/src/services/modules/ecommerce/orderHistory.ts` (`OrderHistoryType`). Add `LINES_CHANGED`, `SHIPPING_RECALCULATED`, `SHIPPING_LINE_EDITED`, `SHIPPING_LINE_ADDED`, `DISCOUNTS_RECALCULATED`, `MANUAL_DISCOUNT_ADDED`, `MANUAL_DISCOUNT_REMOVED`, `REVIEW_FLAG_RAISED`, `REVIEW_FLAG_CLEARED` and `REVIEW_FLAG_DISMISSED`; keep the old types for existing rows.
- Modify: `tests/server/ecommerce/helpers/commerceSetup.ts` (register the service, expose `c.editing`)
- Delete: `tests/server/ecommerce/orders.modify.test.ts`. Its line cases are ported in Task 8.
- Test: `tests/server/ecommerce/orderEditing.runner.test.ts`, `tests/server/ecommerce/orders.admin.test.ts` (view fields), `tests/server/ecommerce/domain/orders.test.ts` (no MODIFY), and the MODIFY expectations in `orders.create.test.ts`, `orders.lifecycle.test.ts`, `orders.promotions.test.ts` and `invoices.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5. From the order service: `computeOrderState`, `get`, `lockOrder`, `recalculate`, `loadCatalog`.
- Produces (inside `orderEditing.ts`):
  - `export type EditKind = 'lines' | 'address' | 'shipping-recalculate' | 'shipping-line-edit' | 'shipping-line-add' | 'discounts' | 'manual-discount-add' | 'manual-discount-remove' | 'review-dismiss'`
  - `export type EditOutcome = { outcome: 'DUE' | 'REFUNDABLE' | 'NONE'; difference: number }`
  - `export type EditResult = { order: OrderView } & EditOutcome`
  - An internal runner, `runEdit<P>(orderId: number, kind: EditKind, rawOperationId: string, actor: string, steps: { prepare: () => Promise<P>; write: (state: OrderState, prepared: P, w: EditWriter) => Promise<EditOutcome & { history: { type: OrderHistoryType; description: string; previousValue: object | null; newValue: object } }> }): Promise<EditResult>`
    - `EditWriter = { actor: string; operationId: string; record(entry): Promise<void>; raise(flags: ReviewFlag[], code: ReviewFlagCode, reason: ReviewReason): ReviewFlag[]; clear(flags: ReviewFlag[], code: ReviewFlagCode): ReviewFlag[] }`. `raise` and `clear` also record `REVIEW_FLAG_RAISED`/`REVIEW_FLAG_CLEARED`; `clear` records only when something was cleared.
    - Order of work:
      1. validate the operationId (8..64 characters, else `{ path: 'operationId', code: 'required' }`);
      2. replay;
      3. `prepare()` outside the transaction;
      4. in the transaction: `lockOrder`, replay check (→ `OPERATION_ID_CONFLICT`), a fresh `computeOrderState`, `write`;
      5. record the main entry with `uniqueKey: 'edit:<operationId>'` and `newValue: { ...history.newValue, kind, operationId, outcome, difference }`;
      6. `recalculate(orderId, { actor, operationId })`;
      7. emit `ORDER_MODIFIED`;
      8. on a unique violation, replay.
    - Replay: a row with that `uniqueKey` on this order with the same kind → its outcome. Another kind, or another order → `OPERATION_ID_CONFLICT`.
  - Internal helpers:
    - `assertEditable(state: OrderState, action: OrderEditAction): void`. It throws `ORDER_NOT_EDITABLE` (with `detail` = `blockedBy`) when `!editing.editable`. It throws `ORDER_HAS_SHIPMENTS` when the action needs no shipments and one exists.
    - `writeTotals(state: OrderState, data: { lines?: true; shippingLines?: ShippingLine[]; orderDiscount?: number; shippingDiscount?: number; manualDiscounts?: ManualDiscount[]; reviewFlags?: ReviewFlag[]; promotions?: object; shippingAddress?: Address }): Promise<OrderTotals>`.
      - It recomputes the totals from the stored lines plus these values, applies ruling 8 when `shippingLines` is given, and always persists the read-through `shippingLines`, `manualDiscounts` and `reviewFlags` (ruling 2).
      - The update is conditional on `orderStatus: 'OPEN'`: 0 rows → `ORDER_NOT_EDITABLE`.
    - `outcomeOf(before: FinancialSummary, after: FinancialSummary): EditOutcome['outcome']`, with the same rule as `simulateModification`.

- [ ] **Step 1: Write the failing tests** in `orderEditing.runner.test.ts`. Drive the runner through a test-only method on the service, `__runEditForTests(orderId: number, kind: EditKind, operationId: string, actor: string): Promise<EditResult>`. Its `write` raises `SHIPPING_REVIEW` (reason `PRODUCTS_CHANGED`) through `writeTotals({ reviewFlags })` and returns outcome `NONE`.
  - The same `operationId` twice → applied once; both calls return the same outcome.
  - The same `operationId` reused with another kind → `OPERATION_ID_CONFLICT` (Review Focus 4). Reused on another order → `OPERATION_ID_CONFLICT`.
  - `operationId: 'short'` → `operationId`/`required`.
  - Run on a `CANCELLED` order → `ORDER_NOT_EDITABLE`, detail `CANCELLED`. With a PENDING shipment → `ORDER_NOT_EDITABLE`, detail `SHIPMENT_PENDING`.
  - `availableActions` never contains `'MODIFY'`, including for an open, unfulfilled order (`domain/orders.test.ts`).
  - **View** (in `orders.admin.test.ts`):
    - a fresh order has `editing.actions` with all 8 actions, `availableActions` without `MODIFY`, and `shippingLines[0]` with `{ id: 1, origin: 'CHECKOUT', amount: 500, paid: false, invoiced: false, spent: false }`;
    - after a payment of the total, `paid: true`;
    - a legacy order (columns set to `null` in the fake DB) shows the same line and its LEGACY manual discount, and `get()` writes nothing (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/orderEditing.runner.test.ts tests/server/ecommerce/orders.admin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `SHIPMENT_PENDING` check now lives in `orderEditing()`. `assertNoPendingShipment` stays for cancel.
- [ ] **Step 4: Run** the tests, then `npx vitest run tests/server/ecommerce` to catch callers of the deleted modification code. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): order editing service with idempotent edit runner; order view editing fields`.

---

### Task 8: Products save (lines) and review evaluation

**Files:**
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts`
- Test: `tests/server/ecommerce/orders.editLines.test.ts` (it ports the line cases of the deleted `orders.modify.test.ts`: add, reduce/restock, remove, snapshot locale, idempotency, concurrent duplicate, `operationId` validation, simulation errors without effect, cancelled order, order-discount cap)

**Interfaces:**
- Consumes: Task 7 runner; `simulateModification` (shipping `KEEP`); `loadCatalog`; the shipping service's `findOption`; the promotions service's `unmet`, `loadCandidates` and `evaluate`.
- Produces:
  - `export type LinesInput = { lines: { orderLineId?: number; variantId: number; quantity: number }[] }`
  - `export type LinesPreview = Pick<ModificationResult, 'errors' | 'before' | 'after' | 'lineChanges' | 'stockMovements' | 'outcome' | 'difference'>`
  - `previewLines(orderId: number | string, input: LinesInput): Promise<LinesPreview>` (writes nothing; `ADD_PRODUCTS` must be available)
  - `applyLines(orderId: number | string, input: LinesInput, actor: string, operationId: string): Promise<EditResult>`
  - Internal helpers used by Tasks 9, 10 and 12:
    - `shippingDue(state: OrderState, units: { variantId: number; quantity: number; orderLineId?: number }[], address: Address | null): Promise<{ due: number; quote: number; previousShipmentsCost: number; option: ShippingOption | null } | { failed: true }>` (ruling 6; no carrier call when no unit is pending)
    - `discountEvaluation(state: OrderState, overrides?: { lines?: DiscountLine[] }): Promise<DiscountRecalculation>` (ruling 12)

- [ ] **Step 1: Write the failing tests:**
  - **Add:** adding a variant to a paid order:
    - one `LINES_CHANGED` entry with `newValue.added`, `newValue.changed`, `newValue.removed`, `totals` before/after, and no `LINE_ADDED` rows;
    - stock is deducted with key `edit:<op>:<variantId>`;
    - the shipping lines are unchanged and `shippingOriginal` is unchanged.
  - **Shipping flag:** with a manual method priced by weight brackets, adding 3 kg changes the quote → `SHIPPING_REVIEW` raised with reason `PRODUCTS_CHANGED`. An unchanged quote → no flag.
  - **Failed quote** (the method no longer serves the country) → the save succeeds and the flag reason is `SHIPPING_QUOTE_FAILED` (Review Focus 5).
  - **Discount flags:**
    - an applied SUBTOTAL ≥ 100 € promotion, lines lowered to 80 € → `DISCOUNTS_REVIEW` raised, discounts unchanged;
    - an automatic promotion that starts to apply after the change → `DISCOUNTS_REVIEW`;
    - neither → no flag.
  - **Discounted lines:** a discounted line raised from 2 to 3 adds a full-price line (as before). A quantity lowered on a discounted line lowers its discount proportionally (as before).
  - **FULFILLED order** (Review Focus 2):
    - lowering a shipped line → `QUANTITY_BELOW_SHIPPED`;
    - adding a new variant → `fulfillmentStatus: 'PARTIALLY_FULFILLED'`, `availableActions` contains `SHIP` (once settled) and not `ARCHIVE`, and the `shippingDue` quote prices only the new units.
  - **Preview:** `previewLines` writes nothing and returns `before`/`after` subtotal and total.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/orders.editLines.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The line writes are moved from the old `writeModification` (create, update, delete, stock); the per-line history rows are dropped.
  - `prepare` runs the simulation draft and `shippingDue` for the draft's pending units.
  - `write` re-runs the simulation on fresh state, writes the lines and stock, and calls `writeTotals({ lines: true, reviewFlags })` with the flags from rulings 20 and 22.
  - `discountEvaluation` runs on the written state (inside the transaction).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): save order products from the Products section; raise review flags`.

---

### Task 9: Shipping address save

**Files:**
- Modify: `server/src/services/modules/ecommerce/shipping.ts`. Add `servedCountries(providerId: string, serviceId: string): Promise<string[]>`:
  - manual methods: the keys of `rates` of that method id (active or not), ∩ the store markets;
  - carriers: `runtime.config.markets` ∩ the store markets;
  - unknown method → `[]`.
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts`
- Test: `tests/server/ecommerce/orders.editAddress.test.ts`, `tests/server/ecommerce/shipping.test.ts`

**Interfaces:**
- Produces:
  - `shippingAddressCountries(orderId: number | string): Promise<{ countries: string[] }>`
  - `updateShippingAddress(orderId: number | string, input: { address: unknown }, actor: string, operationId: string): Promise<EditResult>`: needs `EDIT_ADDRESS`. The address is normalized like `normalizeAddress` in `orders.ts` (export it from there). A country outside `servedCountries` → `{ path: 'address.country', code: 'COUNTRY_NOT_SERVED' }`. An unchanged address (key-sorted compare) → outcome `NONE`, with no history and no flag.

- [ ] **Step 1: Write the failing tests:**
  - `servedCountries('manual', '1')` with rates for PT and ES and markets `['PT']` → `['PT']`. CTT with `config.markets: ['PT', 'ES']` → both when both are markets.
  - **Save:** a new PT address → `ADDRESS_CHANGED` with before/after, a re-quote (whole order), and a flag only if the price differs (reason `ADDRESS_CHANGED`). A quote that fails → flag reason `SHIPPING_QUOTE_FAILED`, and the save succeeds (Review Focus 5).
  - A country not served → 400 `COUNTRY_NOT_SERVED`, nothing written.
  - With an ACTIVE shipment → 409 `ORDER_HAS_SHIPMENTS`. On a cancelled order → `ORDER_NOT_EDITABLE`.
  - The billing address is never changed.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/orders.editAddress.test.ts tests/server/ecommerce/shipping.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `shippingDue` from Task 8 with all the effective units.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): edit the shipping address before any shipment`.

---

### Task 10: Shipping charges: options, recalculate, edit, add

**Files:**
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts`
- Test: `tests/server/ecommerce/orders.editShipping.test.ts`, `tests/server/ecommerce/stripePayments.test.ts` (one case)

**Interfaces:**
- Consumes: Task 1 (`planRecalculation`, `planLineChange`, `appendLine`, `currentMethod`, `chargedShipping`); Task 8 (`shippingDue`).
- Produces:
  - `shippingOptionsForOrder(orderId: number | string): Promise<{ options: ShippingOption[]; failures: { providerId: string; code: string }[] }>` (ruling 7 units, current address)
  - `export type ShippingRecalculationPreview = { charged: number; due: number; quote: number; previousShipmentsCost: number; mode: 'REPLACED' | 'APPENDED' | 'UNCHANGED'; lines: ShippingLine[]; before: ModificationTotals; after: ModificationTotals }`
  - `previewShippingRecalculation(orderId: number | string): Promise<ShippingRecalculationPreview>` (writes nothing; a failed quote → `SHIPPING_QUOTE_FAILED`)
  - `recalculateShipping(orderId: number | string, actor: string, operationId: string): Promise<EditResult>` (clears `SHIPPING_REVIEW`; raises `DISCOUNTS_REVIEW` per ruling 22; history `SHIPPING_RECALCULATED` with charged/due/quote/previousShipmentsCost and lines before/after)
  - `export type ShippingLineInput = { providerId: string; serviceId: string; amount: number }`
  - `editShippingLine(orderId: number | string, lineId: number, input: ShippingLineInput, actor: string, operationId: string): Promise<EditResult>` (needs `EDIT_SHIPPING_LINE`; `SHIPPING_LINE_NOT_FOUND`; history `SHIPPING_LINE_EDITED`)
  - `addShippingLine(orderId: number | string, input: ShippingLineInput, actor: string, operationId: string): Promise<EditResult>` (needs `ADD_SHIPPING_LINE`; history `SHIPPING_LINE_ADDED`)
  - Edit and Add clear `SHIPPING_REVIEW`. A method not in `shippingOptionsForOrder` → `{ path: 'method', code: 'SHIPPING_METHOD_UNAVAILABLE' }`. A bad amount → `{ path: 'amount', code: 'INVALID_AMOUNT' }`. The line method's `name` and `tax` come from the matching option.

- [ ] **Step 1: Write the failing tests:**
  - **Recalculate, no shipment:** charged 500, quote 650 → one RECALCULATION line of 650, `shippingOriginal` 650, `total` +150, outcome `DUE`. Then `createPaymentLink` (Stripe mocked as in `stripePayments.test.ts`) asks for the new `summary.due` (spec 6.2, "verificar").
  - **Recalculate, partially shipped:** an ACTIVE shipment with cost 300, the rest quoted 100, charged 500 → appends −100, outcome `REFUNDABLE` on a paid order, `availableActions` contains `REFUND`, and no refund row is created.
  - **Recalculate, fully shipped, nothing added:** no carrier call (the quoter spy is not called); `due = Σ ACTIVE shipment costs`.
  - **Recalculate, equal:** no line, flag cleared, history `SHIPPING_RECALCULATED` with `mode: 'UNCHANGED'`.
  - **Recalculate, failed quote:** `SHIPPING_QUOTE_FAILED`, nothing written, the flag stays (Review Focus 5).
  - **Shipping promotion:** an order with `shippingDiscount` 500 (SHIPPING_FREE). Recalculating to 700 keeps `shippingDiscount` 500 and raises `DISCOUNTS_REVIEW` (reason `SHIPPING_CHANGED`). Recalculating to 300 → `shippingDiscount` 300.
  - **Edit:**
    - a replaceable line → replaced in place, `shippingMethod`/`shippingTax` updated to the new method;
    - after an invoice that includes shipping → an EDIT line with the difference;
    - with an ACTIVE shipment → `ORDER_HAS_SHIPMENTS`;
    - an unknown line id → `SHIPPING_LINE_NOT_FOUND`;
    - a method not offered for the destination or weight → `SHIPPING_METHOD_UNAVAILABLE`.
  - **Add:** with a shipment → a MANUAL line is appended (allowed) and `SHIPPING_REVIEW` is cleared.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/orders.editShipping.test.ts tests/server/ecommerce/stripePayments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Recalculate: in `prepare`, run `shippingDue(state, pendingUnits, address)`. In `write`, recompute the line views on fresh state, run `planRecalculation`, then `writeTotals({ shippingLines })`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): shipping charges table actions (recalculate, edit, add)`.

---

### Task 11: Promotion usage for edited orders

**Files:**
- Modify: `server/src/services/modules/ecommerce/promotions.ts`
- Test: `tests/server/ecommerce/promotions.test.ts`

**Interfaces:**
- Produces:
  - `reserve(applied, ctx)`: unchanged signature. A `RESERVED` row is still skipped. A `RELEASED` row for this promotion and order is taken back: the same guarded bumps as a new reservation, then a conditional `RELEASED → RESERVED` update with `releasedAt: null` and `amount` = the new amount. A refusal throws `PROMOTION_UNAVAILABLE`.
  - `releasePromotions(orderId: number, promotionIds: number[]): Promise<{ promotionId: number; promotionCode: string | null }[]>`: `releaseForOrder` limited to these ids. It reuses that function's loop, given a filter.
  - `loadCandidatesForOrder(p: { orderId: number; codes: string[]; email: string | null }): Promise<PromotionCandidate[]>`: `loadCandidates` with the counts of this order's `RESERVED` redemptions taken off (ruling 12).

- [ ] **Step 1: Write the failing tests:**
  - **Release and take back:** release P1 of an order with P1 and P2 → only P1 released, `redemptions` −1. `reserve([P1])` again → the row is `RESERVED`, `redemptions` back up, and no new row (the unique key stays).
  - **Limit on take-back:** `usageLimit` reached by other orders while P1 was released → `PROMOTION_UNAVAILABLE`.
  - **Own redemption:** with `perCustomerLimit: 1` and this order's own redemption, `loadCandidatesForOrder` returns `customerUses: 0`, and `evaluatePromotions` with it keeps P1 eligible (Review Focus 1). With `usageLimit: 1, redemptions: 1` (this order) → `redemptions: 0`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/promotions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): re-reserve and partially release promotions on edited orders`.

---

### Task 12: Discounts: recalculate, manual discounts, dismiss flags

**Files:**
- Modify: `server/src/services/modules/ecommerce/orderEditing.ts`
- Test: `tests/server/ecommerce/orders.editDiscounts.test.ts`

**Interfaces:**
- Consumes: Task 4 (`recalculateDiscounts`), Task 3 (`buildManualDiscount`), Task 11.
- Produces:
  - `previewDiscounts(orderId: number | string, input: { selection?: string[] }): Promise<DiscountRecalculation>` (writes nothing; needs `RECALCULATE_DISCOUNTS`)
  - `applyDiscounts(orderId: number | string, input: { selection: string[] }, actor: string, operationId: string): Promise<EditResult>`. The steps:
    1. reject `conflicts` with `PROMOTIONS_NOT_COMBINABLE`, and an unselected locked row with `PROMOTION_GIFT_SHIPPED`;
    2. write the line `unitDiscount`/`promotionRefs`, remove gift lines and restock them (`ORDER_RESTOCK`, key `edit:<op>:<variantId>`);
    3. `reserve(added)` with the customer id and normalized e-mail;
    4. `releasePromotions(removed)`;
    5. store `promotions: { ...stored, applied, recalculatedAt }`;
    6. `writeTotals({ lines: true, orderDiscount, shippingDiscount, manualDiscounts })`;
    7. clear `DISCOUNTS_REVIEW`;
    8. record history `DISCOUNTS_RECALCULATED` with `added`, `removed`, `kept` (promotion ids and amounts; manual ids) and totals before/after.
  - `export type ManualDiscountInput = { kind: 'FIXED' | 'PERCENT'; value: number; reason: string }`
  - `addManualDiscount(orderId, input: ManualDiscountInput, actor, operationId): Promise<EditResult>`: needs `ADD_DISCOUNT`; `orderDiscount += amount`; history `MANUAL_DISCOUNT_ADDED` with `{ id, kind, percent, amount, reason }`.
  - `removeManualDiscount(orderId, discountId: number, actor, operationId): Promise<EditResult>`: needs `REMOVE_DISCOUNT`; `MANUAL_DISCOUNT_NOT_FOUND`; `orderDiscount = max(0, orderDiscount − amount)`; history `MANUAL_DISCOUNT_REMOVED`.
  - `dismissReviewFlag(orderId, code: ReviewFlagCode, actor, operationId): Promise<EditResult>`: `REVIEW_FLAG_NOT_DISMISSABLE` while `editing.editable`; an absent flag → `invalid`; history `REVIEW_FLAG_DISMISSED`.

- [ ] **Step 1: Write the failing tests.** The first one follows spec 2's example.
  - **Spec 2's example:** "2× X oferece Y" (BUY_X_GET_Y `IN_CART`, Y free). The order has 2 X, is paid and invoiced, with no shipment.
    - The merchant adds Y through `applyLines` → `DISCOUNTS_REVIEW` raised.
    - `previewDiscounts` → a `NEW` row for the promotion, unselected.
    - `applyDiscounts` with it selected → Y's `unitDiscount` equals its price; `redemptions` +1; the invoice is unchanged; the flag is cleared.
    - The outcome reflects the Y line (added at full price) and its discount.
  - **Kept invalid:** an applied promotion now expired, kept → its amount is unchanged. Deselected → its amount comes off the total, `releasePromotions` was called, and the outcome is `DUE`.
  - **After invoicing:** a discount added after invoicing → outcome `REFUNDABLE`; no refund or credit-note row is created (anti-goal).
  - **Errors:** a conflicting selection → 409 `PROMOTIONS_NOT_COMBINABLE`. Applying on a cancelled order → `ORDER_NOT_EDITABLE`.
  - **Manual discounts:**
    - PERCENT 10 on a subtotal of 4000 → amount 400, `orderDiscount` +400, history with the reason;
    - removing it restores the total;
    - FIXED above the remaining products → `DISCOUNT_EXCEEDS_PRODUCTS`.
  - **Dismiss:** on an open order → 409 `REVIEW_FLAG_NOT_DISMISSABLE`. On a cancelled order with a raised flag → the flag is removed and `REVIEW_FLAG_DISMISSED` is recorded.
  - **Own redemption:** `perCustomerLimit: 1` with this order's own redemption → `APPLIED_VALID` (Review Focus 1).
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/orders.editDiscounts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): recalculate discounts, manual discounts and flag dismissal`.

---

### Task 13: Controller, routes and error codes

**Files:**
- Create: `server/src/controllers/modules/ecommerce/orderEditing.ts` (`EcommerceOrderEditingController`; parses `:id`, `:lineId` and `:discountId` as positive integers, else 400 `Invalid id`; `actor = user:<id>`; `operationId` from the body)
- Modify: `server/src/controllers/index.ts` (register it)
- Modify: `server/src/controllers/modules/ecommerce/orders.ts` (delete `previewModification` and `applyModification`)
- Modify: `server/src/controllers/modules/ecommerce/errors.ts` (add the ruling 11 codes to `CONFLICT_CODES`)
- Modify: `server/src/routes/ecommerce/admin-orders.ts`. Remove the two modification routes. Add an `editRoute(method, path, handler)` helper (handler prefix `EcommerceOrderEditingController.`, `orders.manage`) and these routes:
  - `GET /:id/shipping-address/countries` → `shippingAddressCountries`
  - `PUT /:id/shipping-address` → `updateShippingAddress`
  - `POST /:id/lines/preview` → `previewLines`
  - `POST /:id/lines` → `applyLines`
  - `GET /:id/shipping-options` → `shippingOptions`
  - `POST /:id/shipping/recalculate/preview` → `previewShippingRecalculation`
  - `POST /:id/shipping/recalculate` → `recalculateShipping`
  - `PUT /:id/shipping-lines/:lineId` → `editShippingLine`
  - `POST /:id/shipping-lines` → `addShippingLine`
  - `POST /:id/discounts/preview` → `previewDiscounts`
  - `POST /:id/discounts` → `applyDiscounts`
  - `POST /:id/manual-discounts` → `addManualDiscount`
  - `POST /:id/manual-discounts/:discountId/remove` → `removeManualDiscount`
  - `POST /:id/review-flags/:code/dismiss` → `dismissReviewFlag`
- Test: `tests/server/ecommerce/ordersRoutes.test.ts`, `tests/server/ecommerce/ordersController.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - Each route exists with `orders.manage` and the module-active middleware. No route path contains `modification`.
  - The controller maps:
    - `ORDER_NOT_EDITABLE` → 409 with `details.code`;
    - `COUNTRY_NOT_SERVED` → 400 with `details.code` (`withCode`);
    - `lineId: 'x'` → 400;
    - `operationId` and body are passed through to the service with `actor: 'user:7'`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/ordersRoutes.test.ts tests/server/ecommerce/ordersController.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): admin routes for editing orders by section`.
- [ ] **Step 6: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 3: Admin UI

### Task 14: Admin types, gateway, use cases and pure helpers

**Files:**
- Modify: `admin/src/ecommerce/orderTypes.ts`:
  - remove `'MODIFY'` from `OrderActionKey`;
  - remove `ModificationShipping`, `OrderModificationInput`, `ApplyModificationInput`, `ModificationApplied` and `DiscountWarning`;
  - keep `ModificationTotals` and the line-related preview fields as `LinesPreview`;
  - add `OrderEditing`, `OrderEditAction`, `ShippingLineView`, `ManualDiscount`, `ReviewFlag`, `ShippingRecalculationPreview`, `DiscountRow`, `DiscountRecalculation` and `EditResult`, mirroring the server types.
  - `Order` gains `editing`, `shippingLines`, `manualDiscounts` and `reviewFlags`.
- Modify: `admin/src/ecommerce/gateways/ecommerceOrdersGateway.ts`. Remove `previewModification`/`applyModification` and add one method per route of Task 13:
  - `previewLines(id, input)`, `applyLines(id, input & { operationId })`
  - `fetchShippingAddressCountries(id)`, `updateShippingAddress(id, { address, operationId })`
  - `fetchShippingOptions(id)`
  - `previewShippingRecalculation(id)`, `recalculateShipping(id, { operationId })`
  - `editShippingLine(id, lineId, input)`, `addShippingLine(id, input)`
  - `previewDiscounts(id, { selection? })`, `applyDiscounts(id, { selection, operationId })`
  - `addManualDiscount(id, input)`, `removeManualDiscount(id, discountId, { operationId })`
  - `dismissReviewFlag(id, code, { operationId })`
- Create: one use case per gateway method in `admin/src/ecommerce/usecases/orders/`, following `applyOrderModification.ts` (`previewOrderLines.ts`, `applyOrderLines.ts`, `fetchShippingAddressCountries.ts`, `updateShippingAddress.ts`, `fetchShippingOptions.ts`, `previewShippingRecalculation.ts`, `recalculateShipping.ts`, `editShippingLine.ts`, `addShippingLine.ts`, `previewDiscounts.ts`, `applyDiscounts.ts`, `addManualDiscount.ts`, `removeManualDiscount.ts`, `dismissReviewFlag.ts`). Delete `previewOrderModification.ts` and `applyOrderModification.ts`.
- Modify: `admin/src/ecommerce/utils/modification.ts`:
  - keep `ModifyLineDraft`, `addModifyLine`, `setModifyLineQuantity`, `removeModifyLine`, `restoreModifyLine`, `toModificationErrorMap` (lines paths only) and `countLines`;
  - replace `modifyFormFromOrder` with `linesDraftFromOrder(order: Order): ModifyLineDraft[]`;
  - replace `buildModificationInput` with `buildLinesInput(lines: ModifyLineDraft[]): { lines: … }`;
  - replace `validateModificationForm` with `validateLinesDraft(lines): FieldError[]`;
  - remove the shipping, address, discount and `discountWarningMessage` code.
- Create: `admin/src/ecommerce/utils/orderEditing.ts`:
  - `canEdit(order: Order, action: OrderEditAction): boolean`
  - `reviewAlerts(order: Order): { code: ReviewFlagCode; reasonKey: string; raisedAt: string; sectionId: 'order-section-shipments' | 'order-section-promotions'; actionable: boolean; dismissable: boolean }[]`
  - `shippingLineRows(order: Order, canManage: boolean): { line: ShippingLineView; badges: ('PAID' | 'INVOICED' | 'SPENT')[]; actions: ('EDIT')[] }[]`
  - `hasRowActions(rows: { actions: unknown[] }[]): boolean`
  - `discountSelectionToggle(selection: string[], row: DiscountRow): string[]` (locked rows stay selected)
  - `manualDiscountDraftToInput(draft: { kind: 'FIXED' | 'PERCENT'; value: string; reason: string }): { input: ManualDiscountInput | null; errors: FieldError[] }` (parses euros with `parseMoneyToCents`; percent with a comma or a dot)
  - `balanceActions(order: Order, perms: OrderActionPermissions): ToolbarAction[]` (REFUND / ADD_PAYMENT / SEND_PAYMENT_INSTRUCTIONS filtered by `allowedToolbarActions`)
- Modify: `admin/src/ecommerce/utils/orderDetail.ts`:
  - remove `MODIFY` from `ACTION_PERMISSION` and `ToolbarAction`;
  - rename `modifyBlockedByShipment` to `editBlockedByShipment(order: Order): boolean` (`order.editing.blockedBy === 'SHIPMENT_PENDING'`);
  - `historyChange` covers `LINES_CHANGED` (`totals.total` before → after), `SHIPPING_RECALCULATED`/`SHIPPING_LINE_EDITED`/`SHIPPING_LINE_ADDED` (charged before → after), `DISCOUNTS_RECALCULATED` (total before → after) and `MANUAL_DISCOUNT_ADDED`/`MANUAL_DISCOUNT_REMOVED` (amount);
  - add the new error codes of ruling 11 to `API_ERROR_CODES`.
- Modify: `admin/src/ecommerce/utils/orderModals.ts` (no `MODIFY`)
- Test: `tests/admin/ecommerce/orderEditing.test.ts`, `tests/admin/ecommerce/modification.test.ts`, `tests/admin/ecommerce/orderDetail.test.ts`, `tests/admin/ecommerce/orderModals.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - **`reviewAlerts`:**
    - an open order with both flags → two items, shipments first, `actionable: true`, `dismissable: false`;
    - a cancelled order → `actionable: false`, `dismissable: true`;
    - `reasonKey` is `ecommerce.orders.review.reason.<REASON>`.
  - **`shippingLineRows`:** badges follow `paid`/`invoiced`/`spent`. `actions: ['EDIT']` only when `EDIT_SHIPPING_LINE` is in `editing.actions` and `canManage`. `hasRowActions` is false when no row has one.
  - **`discountSelectionToggle`:** it never removes a `locked` row.
  - **`manualDiscountDraftToInput`:**
    - `{ kind: 'PERCENT', value: '10,5', reason: 'x' }` → `value: 10.5`;
    - `{ kind: 'FIXED', value: '5', reason: '' }` → a `reason` error;
    - `{ kind: 'FIXED', value: '5,00' }` → 500.
  - **`balanceActions`:** with `due > 0` and `canPay` → `['ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS']`; with `REFUND` available and `canRefund` → `['REFUND']`.
  - **`historyEntryText`:** `LINES_CHANGED` → a money change before/after.
  - **Toolbar:** `allowedToolbarActions` never yields `MODIFY`.
  - **Lines draft:** `buildLinesInput` keeps gift lines at their original quantity and omits removed lines (ported from the existing modification tests).
- [ ] **Step 2: Run** `npx vitest run tests/admin/ecommerce`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, then the admin typecheck. tsc errors in components that still use the removed types are expected and are fixed in Tasks 15–18. To keep this commit green, delete `ModifyOrderModal.tsx`, `ModificationSummary.tsx` and `SupplementaryPaymentModal.tsx` now. Remove their usage from `OrderDetailPage.tsx` (the `MODIFY` modal, `afterModification`, `supplementary`) and `OrderHeader.tsx` (the `MODIFY` variant; use `editBlockedByShipment`). Expected: PASS and tsc clean.
- [ ] **Step 5: Commit** `feat(ecommerce): admin API client and helpers for order editing; remove the Modify flow`.

---

### Task 15: Page skeleton: review alerts, anchors, result step

**Files:**
- Modify: `admin/src/ecommerce/components/orders/OrderSection.tsx` (optional `id?: string` on the root `Box`)
- Create: `admin/src/ecommerce/components/orders/ReviewAlerts.tsx`. It renders one `Alert variant="danger"` per `reviewAlerts(order)` item, with:
  - title = the flag text;
  - body = the reason with the date (`formatDate`, `dateStyle: 'short'`, `timeStyle: 'short'`);
  - a "Go to section" `Link` that scrolls to `#<sectionId>`;
  - when not actionable, the line "This order can no longer be changed" and a **Dismiss** button (`canManage` only), which calls `DismissReviewFlag` with a fresh `mintUuid()`.
- Create: `admin/src/ecommerce/components/orders/BalanceOutcome.tsx` (`{ order: Order; outcome: 'DUE' | 'REFUNDABLE'; permissions: OrderActionPermissions; onAction: (a: ToolbarAction) => void }`). It shows "Amount due: X" or "Eligible for refund: X" and the `balanceActions` buttons.
- Modify: `admin/src/ecommerce/pages/orders/OrderDetailPage.tsx`:
  - render `ReviewAlerts` under the header;
  - give the sections ids `order-section-lines`, `order-section-shipments` and `order-section-promotions`;
  - add `showResult(result: EditResult)`, which sets the order from `result.order` (the same supersede logic as the removed `afterModification`). Tasks 16–18 call it.
- Modify: `admin/src/core/translations/en.json`, `pt.json`. Remove the `ecommerce.orders.modify.*` keys that are no longer used, and the `detail.actions.MODIFY` key. Add these keys (en / pt):
  - `ecommerce.orders.review.SHIPPING_REVIEW` "Shipping may need to be recalculated." / "Os portes podem precisar de ser recalculados."
  - `ecommerce.orders.review.DISCOUNTS_REVIEW` "Discounts may need to be reassessed." / "Os descontos podem precisar de ser reavaliados."
  - `ecommerce.orders.review.reason.PRODUCTS_CHANGED` "Products changed on {date}" / "Produtos alterados a {date}"
  - `ecommerce.orders.review.reason.ADDRESS_CHANGED` "Shipping address changed on {date}" / "Morada de entrega alterada a {date}"
  - `ecommerce.orders.review.reason.SHIPPING_CHANGED` "Shipping changed on {date}" / "Portes alterados a {date}"
  - `ecommerce.orders.review.reason.SHIPPING_QUOTE_FAILED` "The shipping method could not be quoted on {date}" / "Não foi possível cotar o método de entrega a {date}"
  - `ecommerce.orders.review.goTo` "Go to section" / "Ir para a secção"
  - `ecommerce.orders.review.locked` "This order can no longer be changed, so this cannot be recalculated." / "Esta encomenda já não pode ser alterada, por isso já não é possível recalcular."
  - `ecommerce.orders.review.dismiss` "Dismiss" / "Dispensar"
  - `ecommerce.orders.balance.due` "Amount due: {amount}" / "Valor em dívida: {amount}"
  - `ecommerce.orders.balance.refundable` "Eligible for refund: {amount}" / "Elegível para reembolso: {amount}"
  - `ecommerce.orders.history.type.<each new type>`, with titles in en and pt (e.g. `LINES_CHANGED` "Products changed" / "Produtos alterados"; `REVIEW_FLAG_DISMISSED` "Warning dismissed" / "Aviso dispensado")
  - `ecommerce.orders.errors.<each new code>` (e.g. `ORDER_NOT_EDITABLE` "This order can no longer be changed." / "Esta encomenda já não pode ser alterada."; `ORDER_HAS_SHIPMENTS` "The order already has shipments." / "A encomenda já tem envios.")
- Test: `tests/admin/ecommerce/registerTrads.test.ts` (en/pt parity already enforced)

- [ ] **Step 1: Implement** the components and the page changes.
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 3: Commit** `feat(ecommerce): review alerts and balance result on the order page`.

---

### Task 16: Products section: Add products modal

**Files:**
- Create: `admin/src/ecommerce/components/orders/OrderProductsModal.tsx` (`{ order: Order; permissions: OrderActionPermissions; onClose(): void; onSaved(result: EditResult): void; onAction(a: ToolbarAction): void }`). It reuses `VariantPicker`, `ModifyLinesEditor` and `linesDraftFromOrder`/`addModifyLine`/….
  - The operationId is minted once per opening.
  - Steps: edit → **Review** (`PreviewOrderLines`: subtotal and total before → after, plus `countLines`) → **Save** (`ApplyOrderLines`).
  - Server line errors are mapped with `toModificationErrorMap`.
  - The result step (`BalanceOutcome`) is shown when the outcome is not `NONE`.
- Modify: `OrderDetailPage.tsx`. The Products `OrderSection` gets `actions`: an **Add products** button, shown when `canManage && canEdit(order, 'ADD_PRODUCTS')`.
- Modify: translations (en / pt):
  - `ecommerce.orders.products.add` "Add products" / "Adicionar produtos"
  - `ecommerce.orders.products.title` "Products of order #{reference}" / "Produtos da encomenda #{reference}"
  - `.review` "Review" / "Rever"
  - `.save` "Save" / "Guardar"
  - `.note` "Shipping and discounts are not changed. You will be warned if they need a review." / "Os portes e os descontos não mudam. Será avisado se precisarem de revisão."
  - `.subtotal`, `.total`, `.before`, `.after` (reuse the existing `modify.summary.*` texts under the new keys and delete the old ones)

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 3: Manual check.** On the test project (memory: backend-base on :1337), add a product to an order and confirm that a SHIPPING_REVIEW alert appears when the weight bracket changes.
- [ ] **Step 4: Commit** `feat(ecommerce): add and change products from the Products section`.

---

### Task 17: Shipments section: address modal and shipping charges

**Files:**
- Create: `admin/src/ecommerce/components/orders/ShippingAddressModal.tsx`. It replaces `AddressButton` in `ShipmentsSection` (the button keeps the `Pin` icon and title).
  - Editable when `canManage && canEdit(order, 'EDIT_ADDRESS')`: `AddressFields`, with a new optional `countries?: string[]` prop restricting the country select (fetched with `FetchShippingAddressCountries` when the modal opens), and **Save** (`UpdateShippingAddress`).
  - Otherwise: the same fields `disabled`, plus a warning box with the reason: `editing.blockedBy`, or `HAS_SHIPMENTS` when `editing.hasShipments`, → keys `ecommerce.orders.address.locked.<REASON>`.
- Modify: `admin/src/ecommerce/components/orders/AddressFields.tsx` (optional `countries` prop)
- Create: `admin/src/ecommerce/components/orders/ShippingChargesTable.tsx`. Columns: method (name, origin under it), date, amount (signed, `formatCents`), status (`ToneBadge` per badge) and actions (`ColumnLabel`, hidden when `!hasRowActions`).
- Create: `admin/src/ecommerce/components/orders/ShippingLineModal.tsx` (`mode: 'EDIT' | 'ADD'`). It loads `FetchShippingOptions` and shows a radio list of methods with the suggested price; the price field is prefilled with the suggestion and editable. It saves with `EditShippingLine`/`AddShippingLine`, then shows the result step. A method list that comes back empty → `EmptyNote` "No shipping method serves this address and weight."
- Create: `admin/src/ecommerce/components/orders/RecalculateShippingModal.tsx`. It loads `PreviewShippingRecalculation` and shows charged, due (previous shipments + quote), the proposed table (`ShippingChargesTable` read-only) and the totals before → after. **Confirm** → `RecalculateShipping`, then the result step. An unchanged result → the text "Shipping is already correct." and **Confirm** still clears the flag.
- Modify: `admin/src/ecommerce/components/orders/ShipmentsSection.tsx`. Props gain `order: Order`, `permissions` and `onEdited(result: EditResult)`. Header actions: delivery status, the address button, **Recalculate shipping** and **Add shipping** (when allowed). Body: a "Shipping charges" sub-heading with `ShippingChargesTable` above the shipments table.
- Modify: `OrderDetailPage.tsx` (pass the new props)
- Modify: translations (en / pt):
  - `ecommerce.orders.shippingCharges.title` "Shipping charges" / "Cobranças de portes"
  - `.recalculate` "Recalculate shipping" / "Recalcular portes"
  - `.add` "Add shipping" / "Adicionar portes"
  - `.edit` "Edit" / "Editar"
  - `.origin.CHECKOUT` "Checkout" / "Checkout"
  - `.origin.RECALCULATION` "Recalculation" / "Recálculo"
  - `.origin.EDIT` "Edited" / "Editado"
  - `.origin.MANUAL` "Added manually" / "Adicionado manualmente"
  - `.badge.PAID` "Paid" / "Pago"
  - `.badge.INVOICED` "Invoiced" / "Faturado"
  - `.badge.SPENT` "Shipped" / "Gasto"
  - `.columns.method|date|amount|status|actions`
  - `.charged` "Charged" / "Cobrados"
  - `.due` "Due" / "Devidos"
  - `.unchanged` "Shipping is already correct." / "Os portes já estão certos."
  - `.noMethods` "No shipping method serves this address and weight." / "Nenhum método de entrega serve esta morada e este peso."
  - `.suggested` "Suggested price: {amount}" / "Preço sugerido: {amount}"
  - `ecommerce.orders.address.locked.HAS_SHIPMENTS` "The order already has shipments." / "A encomenda já tem envios."
  - `.CANCELLED` "The order is cancelled." / "A encomenda está cancelada."
  - `.ARCHIVED` "The order is archived." / "A encomenda está arquivada."
  - `.SHIPMENT_PENDING` "A shipment is still pending at the carrier." / "Há um envio pendente na transportadora."

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 3: Manual check** on the test project: recalculate after a weight change; edit a line before shipping; add a line after a shipment.
- [ ] **Step 4: Commit** `feat(ecommerce): shipping charges table, address modal and shipping actions`.

---

### Task 18: Promotions section: recalculate discounts and manual discounts

**Files:**
- Create: `admin/src/ecommerce/components/orders/RecalculateDiscountsModal.tsx`. It loads `PreviewDiscounts()` and shows a table grouped by `kind`, in the spec 7.1 order (valid, invalid, new, manual): a checkbox, the name (and code), the current amount, the amount, and for invalid rows "Not valid today, but it was on the purchase date" with the translated `invalidReason`. A locked row has a disabled checkbox with a hint.
  - Each toggle re-requests `PreviewDiscounts({ selection })`, debounced 300 ms; only the latest response is applied.
  - The totals are current → after.
  - `conflicts.length > 0` → a danger box ("These promotions cannot be combined: A, B") and **Confirm** disabled.
  - **Confirm** → `ApplyDiscounts`, then the result step.
- Create: `admin/src/ecommerce/components/orders/ManualDiscountModal.tsx`: kind radio (Fixed amount / Percentage), value, reason (required, 200 maximum). It saves with `AddManualDiscount`, then the result step.
- Modify: `admin/src/ecommerce/components/orders/PromotionsSection.tsx`:
  - props gain `order`, `permissions` and `onEdited`;
  - `actions`: **Recalculate discounts** and **Add discount** when allowed;
  - manual discounts are extra rows (method "Manual", benefit = the reason, with "10 % (5,00 €)" for PERCENT and the translated legacy reason for LEGACY);
  - `promotionsDiscountTotal` + manual amounts go into the "Total discount:" row;
  - an Actions column (`ColumnLabel`) with **Remove** on manual rows (with `REMOVE_DISCOUNT`; confirm dialog, `RemoveManualDiscount`), hidden when no row has an action;
  - the empty state is shown only when there are no promotions, no manual discounts and no unapplied codes.
- Modify: `OrderDetailPage.tsx` (pass the props)
- Modify: translations (en / pt):
  - `ecommerce.orders.discounts.recalculate` "Recalculate discounts" / "Recalcular descontos"
  - `.add` "Add discount" / "Adicionar desconto"
  - `.remove` "Remove" / "Remover"
  - `.group.APPLIED_VALID` "Applied and still valid" / "Aplicada e ainda válida"
  - `.group.APPLIED_INVALID` "Applied but no longer valid" / "Aplicada mas já não válida"
  - `.group.NEW` "Would apply now" / "Aplicar-se-ia agora"
  - `.group.MANUAL` "Manual discounts" / "Descontos manuais"
  - `.invalidToday` "Not valid today, but it was on the purchase date" / "Não é válida hoje, mas era no dia da compra"
  - `.reason.<RejectionReason | NOT_FOUND>` (e.g. `EXPIRED` "Expired" / "Expirada"; `CONDITIONS_NOT_MET` "Conditions not met" / "Condições por cumprir"; `USAGE_LIMIT_REACHED` "Usage limit reached" / "Limite de utilizações atingido"; `INACTIVE` "Deactivated" / "Desativada"; `NOT_FOUND` "Deleted" / "Eliminada")
  - `.conflict` "These promotions cannot be combined: {names}" / "Estas promoções não acumulam: {names}"
  - `.giftShipped` "Its gift was already shipped." / "A oferta já foi enviada."
  - `.manual` "Manual" / "Manual"
  - `.kind.FIXED` "Fixed amount" / "Valor fixo"
  - `.kind.PERCENT` "Percentage" / "Percentagem"
  - `.reasonLabel` "Reason" / "Motivo"
  - `.legacyReason` "Previous manual adjustment" / "Ajuste manual anterior"
  - `.current` "Current" / "Atual"
  - `.after` "After" / "Depois"

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS.
- [ ] **Step 3: Manual check** on the test project: the spec 2 example ("2× X oferece Y") end to end; then a manual discount after invoicing → Refund appears and nothing is refunded automatically.
- [ ] **Step 4: Commit** `feat(ecommerce): recalculate and add discounts from the promotions section`.
- [ ] **Step 5: Phase gate.** Run `npx vitest run` and the three typechecks. Expected: all green.

---

## Phase 4: Documentation

### Task 19: Update the e-commerce design and follow-ups

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-ecommerce-design.md`:
  - **§4.4:**
    - "Pagamento complementar após uma modificação" becomes: new product lines and the new shipping lines or differences;
    - coverage keeps one shipping slot by value, with the "paga" state per line derived (ruling 5);
    - a negative shipping line only creates excess;
    - one invoice shipping line per VAT rate;
    - discounts or shipping recalculated after invoicing only move the balance; the credit note is issued only at the administrator's request;
    - mark **[Decisão, 2026-11-13]** where the spec marks Decisão.
  - **§4.8:** rewrite it. Saving products never re-evaluates (the line rules stay). **Recalcular descontos** exists while the order can be changed (spec 7.1 and 7.3). Shipping changes keep the shipping discount in euros (capped at the gross) and raise `DISCOUNTS_REVIEW`; this replaces "a promoção de portes deixa de se aplicar". The manual adjustment becomes the free discount (7.2). The persistent warnings replace the "aviso no resumo da modificação".
  - **§6:** the paragraph "Uma modificação de encomenda não consome nem liberta utilizações" becomes: confirming Recalcular descontos reserves or releases uses (rulings 16–17).
  - **§4.1:** add that an order fully shipped that receives new products goes back to `PARTIALLY_FULFILLED`, so Archive is unavailable until those products are shipped.
  - Add **§4.17 "Edição da encomenda por secções [Decisão, 2026-11-13]"**: a short summary with a link to `docs/superpowers/specs/2026-11-13-order-editing-design.md`. It states that it replaces requirement 16's single modification flow and the **Modify** button.
- Modify: `docs/superpowers/plans/ecommerce-followups.md`:
  - remove the "P6 final: modify modal …" item (the modal is gone);
  - reword the P4 item about MODIFY with PROCESSING refunds so it names the new edit actions;
  - add "shipping line `invoiced` is derived from invoice dates (prudent); store shipping-line ids on coverages if per-line invoicing is ever needed".
- Check: `docs/ecommerce/storefront-api.md` needs no change (contract unchanged); `grep -n -i "modif" docs/ecommerce/storefront-api.md` shows nothing to change.

- [ ] **Step 1: Edit the docs** (in Portuguese, the style of the design document).
- [ ] **Step 2: Run** the full suite `npx vitest run` and the three typechecks. Expected: all green.
- [ ] **Step 3: Commit** `docs(ecommerce): order editing by section in the design (4.1, 4.4, 4.8, 4.17, 6)`.
