# Per-market Shipping (replaces Shipping Zones) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove shipping zones. Each manual shipping method chooses the markets (countries) it serves, with weight brackets per market. A carrier (CTT) chooses its markets.

**Architecture:** A pure domain module, `domain/shippingRates.ts`, validates and evaluates `MarketRates` (country → weight brackets). The settings service stores these rates on the manual methods (the `rates` json column, same column, new shape). It validates carrier `markets` fields and blocks removing a market in use. `shipping.ts` quotes by country and order weight. The admin replaces the zones UI with a market picker and bracket tables.

**Tech Stack:** Strapi 5 plugin (TypeScript server, React admin with `@strapi/design-system` v2), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (§4.16 shipping), `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`. The user's decisions in this conversation (2026-11-12) override §4.16 where they differ:
- **Markets:** markets stay in Settings → General (`markets` store setting). Shipping zones are removed.
- **Manual method:** selects markets. Each market has weight brackets `{ upTo: kg | null, price: cents }`. `upTo` is an upper limit only; the lower limit is the previous `upTo` (exclusive), and 0 for the first. Only the last bracket may be `null` (no limit).
- **Order weight:** Σ variant weight (kg) × quantity. A weight above the last bracket means the method is **unavailable** for that order.
- **Manual method modal:** "Select all markets"; a per-market bracket table; "Apply this table to all selected markets".
- **CTT:** a `markets` field (countries, subset of the store markets) with "Select all", instead of `zones`. Its price still comes from the CTT API ([[ctt-pricing-pending]]).
- **Removing a market:** removing a market in General that a manual method or carrier uses is **blocked** (`MARKET_IN_USE`, listing the method/carrier names). Nothing is saved.
- **Storefront contract:** unchanged. `shippingOptions` items stay `{ providerId, serviceId, name, price, tax, estimatedDays? }`, and the bodies and errors of `POST /cart/quote` and `POST /orders` stay the same.

## Global Constraints

- "Não quero alterar o que já existe": no change outside the e-commerce module.
- Any Strapi DB (the client uses MariaDB): no `@strapi/utils` imports. JSON columns hold objects only (the `rates` column stays an object keyed by country). Unique attributes need an `indexes` entry.
- Field names in English. Admin UI in en + pt (`admin/src/core/translations/{en,pt}.json`, keys prefixed `littlebox-strapi-suite.`).
- Money in integer cents, VAT included. Max `MAX_MONEY_CENTS` from `server/src/services/modules/ecommerce/domain/orders.ts`.
- Typecheck with `npx tsc -p server/tsconfig.json --noEmit`, `npx tsc -p admin/tsconfig.json --noEmit` and `npx tsc -p tests/tsconfig.json --noEmit`. Always pass `--noEmit`.
- Tests: `npx vitest run <path>`. Full suite: `npx vitest run`.
- Commit with explicit paths, never `git add -A`. Never touch `.yalc/` or `yalc.lock`. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No data migration code: zones existed only on the developer's local test DB. Stored manual-method `rates` whose values are not arrays (the old `zoneId → cents` shape) are ignored when read. The controller re-enters the local test data after the merge.

## Review Focus

1. **Bracket boundaries:** a weight exactly equal to `upTo` belongs to that bracket. 1.0 kg → the "up to 1" bracket; 1.0001 kg → the next one. Pinned in Task 1.
2. **Floating-point weight sums:** 0.1 kg × 3 must equal the 0.3 kg bracket limit, not 0.30000000000000004. Weights are summed in grams (rounded integers) before comparing. Pinned in Task 1.
3. **A method with brackets for PT only, quoted for ES:** must not appear. A method whose brackets all end below the order weight must not appear either, and that is not a failure. Pinned in Task 3.
4. **Updating a method after a market was removed from General is impossible** (removal is blocked). But stored keys for countries no longer in the markets (an old row, or a market removed before this change) must not block the update: they are dropped on update, like stale zone prices were. Pinned in Task 2.
5. **CTT active with an empty `markets` list:** activation is refused (`required`), as `zones` was. A saved `markets` entry outside the store markets → `invalid_country`. Pinned in Task 2.

---

### Task 1: Market rates domain

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/shippingRates.ts`
- Test: `tests/server/ecommerce/shippingRates.test.ts`

**Interfaces:**
- Produces:
  - `export type WeightBracket = { upTo: number | null; price: number }` (`upTo` in kg, at most 3 decimals; `price` in cents).
  - `export type MarketRates = Record<string, WeightBracket[]>` (key = ISO 3166-1 alpha-2 country, upper case).
  - `export function normalizeMarketRates(input: unknown, markets: ReadonlySet<string>, errors: { path: string; code: string }[]): MarketRates`
  - `export function readMarketRates(stored: unknown): MarketRates` (lenient reader for stored rows: keeps only keys whose value is a valid bracket array, so old zone-shaped rows read as `{}`).
  - `export function orderWeightGrams(items: { weight: number; quantity: number }[]): number`
  - `export function priceForWeight(brackets: WeightBracket[], weightGrams: number): number | null`

- [ ] **Step 1: Write the failing tests** in `tests/server/ecommerce/shippingRates.test.ts`:
  - `normalizeMarketRates({ PT: [{ upTo: 1, price: 300 }, { upTo: 5, price: 1000 }, { upTo: null, price: 2000 }] }, new Set(['PT']), errs)` returns the same object, and `errs` is `[]`.
  - Error paths and codes (one assertion each, `errs` checked with `toContainEqual`):
    - a key not in markets → `{ path: 'rates.ES', code: 'invalid_country' }`;
    - an empty array → `{ path: 'rates.PT', code: 'required' }`;
    - `upTo` not increasing (`[{upTo:5},{upTo:1}]`) → `{ path: 'rates.PT.1.upTo', code: 'out_of_range' }`;
    - `upTo: 0` or negative → `out_of_range`;
    - `upTo: 1.2345` (4 decimals) → `invalid_number`;
    - `null` not last → `{ path: 'rates.PT.0.upTo', code: 'out_of_range' }`;
    - `price` not an integer, or outside 0..`MAX_MONEY_CENTS` → `invalid_number` / `out_of_range` at `rates.PT.<i>.price`;
    - input not an object → `{ path: 'rates', code: 'invalid_number' }`.
  - A lower-case key `pt` is upper-cased and accepted. `null`/`undefined` input → `{}`.
  - `readMarketRates({ '3': 350, PT: [{ upTo: null, price: 350 }] })` → `{ PT: [{ upTo: null, price: 350 }] }`.
  - `orderWeightGrams([{ weight: 0.1, quantity: 3 }])` → `300`. `orderWeightGrams([{ weight: 1.25, quantity: 2 }, { weight: 0, quantity: 9 }])` → `2500`. A missing or negative weight counts as 0.
  - `priceForWeight(B, g)` with `B = [{upTo:1,price:300},{upTo:5,price:1000}]`: `0`→300, `1000`→300, `1001`→1000, `5000`→1000, `5001`→`null`. With a last `{upTo:null,price:2000}`: `9_999_000`→2000.

- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/shippingRates.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `shippingRates.ts`. Compare in grams: `Math.round(upTo * 1000)`. Bracket `i` covers `(prevLimit, limit]`, where the first bracket starts at 0 inclusive.

- [ ] **Step 4: Run** the test again. Expected: PASS.

- [ ] **Step 5: Commit** `feat(ecommerce): market rates domain (weight brackets per country)`.

---

### Task 2: Settings service: methods by market, carrier `markets`, market-in-use

**Files:**
- Modify: `server/src/services/modules/ecommerce/settings.ts` (`ManualMethod`, `ManualMethodInput`, `normalizeRates`, `normalizeManualMethod`, `toManualMethod`, `zoneIds`, `removeZoneReferences`, `updateIntegration` zone checks, `updateStoreSettings` market check, create/update manual method)
- Modify: `server/src/services/modules/ecommerce/providers/registry.ts` (field type `'zones'` → `'markets'`; validation in `validateProviderInput`)
- Modify: `server/src/services/modules/ecommerce/providers/definitions/ctt-expresso.ts` (`{ key: 'markets', type: 'markets', required: true, default: [], label: `${L}.markets` }`)
- Test: `tests/server/ecommerce/settings.test.ts`, `tests/server/ecommerce/providers/registry.test.ts`, `tests/server/ecommerce/helpers/settingsStrapi.ts`

**Interfaces:**
- Consumes: Task 1 (`MarketRates`, `normalizeMarketRates`, `readMarketRates`).
- Produces:
  - `ManualMethod.rates: MarketRates`. `ManualMethodInput.rates?: unknown` (validated against the store markets).
  - Provider field type `'markets'`: the value is `string[]` of country codes. It is `required` only when active (same rule as `zones` had). The settings service checks each code is in the store markets, else `{ path: 'config.<key>', code: 'invalid_country' }`.
  - `updateStoreSettings` throws `EcommerceValidationError` with `{ path: 'markets', code: 'MARKET_IN_USE', detail: <method name in default locale | provider name> }` for each manual method or stored carrier integration that still uses a removed country.
  - `removeZoneReferences` and `zoneIds` are deleted.

- [ ] **Step 1: Write the failing tests** (replace the zone-based ones; keep the file's existing helpers):
  - Creating a manual method with `rates: { PT: [{ upTo: null, price: 350 }] }` while the markets are `['PT']` stores and returns those rates.
  - With markets `['PT']`, `rates: { ES: [...] }` → validation error `rates.ES` / `invalid_country`.
  - Updating a method whose stored rates include `FR` (no longer a market) with `{ tax: 6 }` succeeds and drops `FR` (Review Focus 4).
  - `updateStoreSettings({ markets: ['ES'] })` when a method uses `PT` → `MARKET_IN_USE` with `detail` = the method name, and the markets are unchanged. The same for a CTT integration whose `config.markets` has `PT`, with `detail: 'CTT Expresso'`.
  - Saving CTT with `config.markets: ['DE']` while the markets are `['PT']` → `invalid_country` at `config.markets`. Activating CTT with `markets: []` → refused with `required` (Review Focus 5).
  - Registry test: the CTT definition has a `markets` field of type `'markets'`, and no field of type `'zones'`.

- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/settings.test.ts tests/server/ecommerce/providers/registry.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `normalizeManualMethod(input, defaultLocale, markets: ReadonlySet<string>)` uses `normalizeMarketRates`.
  - A method with no market at all → `{ path: 'rates', code: 'required' }`.
  - `toManualMethod` uses `readMarketRates`.
  - On update, drop the stored countries not in the markets before merging.
  - Store markets come from `getStoreSettings().markets`.

- [ ] **Step 4: Run** the tests again. Expected: PASS.

- [ ] **Step 5: Commit** `feat(ecommerce): manual methods and carriers choose markets`.

---

### Task 3: Quote by market and weight; remove the shipping-zone module

**Files:**
- Modify: `server/src/services/modules/ecommerce/shipping.ts` (quote; drop `zoneId` from `ShippingQuoteRequest`; drop `listZones`)
- Delete: `server/src/services/modules/ecommerce/shippingZones.ts`, `server/src/content-types/modules/ecommerce/shipping-zone/`, and the zone routes and controller methods (`listShippingZones`, `createShippingZone`, `updateShippingZone`, `deleteShippingZone`)
- Modify: `server/src/content-types/index.ts`, `server/src/services/index.ts`, `server/src/config/index.ts` (`shippingZone` uid), `server/src/routes/ecommerce/admin-settings.ts`, `server/src/controllers/modules/ecommerce/settings.ts`, `server/src/controllers/modules/ecommerce/errors.ts` (drop `ZONE_COUNTRY_CONFLICT`)
- Delete tests: `tests/server/ecommerce/shippingZones.test.ts`. Modify: `tests/server/ecommerce/shipping.test.ts`, `settingsRoutes.test.ts`, `settingsController.test.ts`, `settingsContentTypes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`orderWeightGrams`, `priceForWeight`) and Task 2 (`ManualMethod.rates: MarketRates`, carrier `config.markets: string[]`).
- Produces: `quote(req)`, same signature and return as today, minus `zoneId`.
  - **Manual methods:** for an active method, `brackets = rates[req.country]`; then `price = priceForWeight(brackets, orderWeightGrams(req.items))`. `null` or no brackets → no option.
  - **Carriers:** quoted only when `Array.isArray(runtime.config.markets) && runtime.config.markets.includes(req.country)`.

- [ ] **Step 1: Write the failing tests** in `shipping.test.ts` (rewrite the zone cases):
  - Markets `['PT','ES']`; a method with `PT: [{upTo:1,price:300},{upTo:5,price:1000}]`.
    - Items of 0.4 kg × 2 → price 300.
    - 3 kg → 1000.
    - 6 kg → no manual option, `failures: []`.
    - Country `ES` → no manual option (Review Focus 3).
  - A country outside the markets → `{ options: [], failures: [] }`.
  - A carrier with `config.markets: ['ES']` is not called for `PT` and is called for `ES`.
  - `settingsRoutes.test.ts` no longer lists the `/shipping-zones` routes, and asserts no route path contains `shipping-zones`.

- [ ] **Step 2: Run** `npx vitest run tests/server/ecommerce/shipping.test.ts tests/server/ecommerce/settingsRoutes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the quote change and delete the zone module and its wiring. Then `grep -rn -i "shippingZone\|shipping-zone\|zoneId\|ZONE_COUNTRY" server/src tests/server` must return nothing.

- [ ] **Step 4: Run** `npx tsc -p server/tsconfig.json --noEmit && npx tsc -p tests/tsconfig.json --noEmit && npx vitest run tests/server`. Expected: all PASS.

- [ ] **Step 5: Commit** `feat(ecommerce): quote shipping by market and order weight; remove shipping zones`.

---

### Task 4: Admin forms (pure)

**Files:**
- Modify: `admin/src/ecommerce/settingsTypes.ts`. Add `WeightBracket`, `MarketRates`; `ManualMethod.rates: MarketRates`. Remove `ShippingZone` and `ShippingZoneInput`. `ProviderField.type`: `'zones'` → `'markets'`.
- Modify: `admin/src/ecommerce/utils/manualMethodForm.ts` (rewrite), `admin/src/ecommerce/utils/integrationForm.ts` (`zones` → `markets`), `admin/src/ecommerce/utils/settingsForm.ts` (`marketInUseZones` → `marketInUseNames`)
- Delete: `admin/src/ecommerce/utils/shippingZoneForm.ts`, `tests/admin/ecommerce/shippingZoneForm.test.ts`
- Test: `tests/admin/ecommerce/integrationForm.test.ts` (manual method form tests live there), `tests/admin/ecommerce/settingsForm.test.ts`

**Interfaces:**
- Produces (`manualMethodForm.ts`):
  - `type BracketDraft = { upTo: string; price: string }` (`upTo` `''` = no limit, last row only).
  - `type ManualMethodDraft = { names: Record<string,string>; markets: string[]; brackets: Record<string, BracketDraft[]>; taxChoice: string; taxOther: string; active: boolean }`
  - `emptyManualMethodDraft(localeCodes: string[]): ManualMethodDraft`. No market selected.
  - `manualMethodToDraft(method: ManualMethod, localeCodes: string[], uiLocale: string, markets: string[]): ManualMethodDraft`. Only countries still in `markets`; kg shown with up to 3 decimals; prices via `centsToText`.
  - `newBracketRows(): BracketDraft[]` → `[{ upTo: '', price: '' }]`.
  - `applyToAllMarkets(draft: ManualMethodDraft, from: string): ManualMethodDraft`. Copies `brackets[from]` (deep copy) to every selected market.
  - `draftToManualMethodInput(draft, defaultLocale): { input?: ManualMethodInput; errors: ManualMethodErrors }`.
    - Error paths mirror the server: `markets` = `required` when none is selected.
    - Per row: `rates.<CC>.<i>.upTo` / `.price`. `upTo` accepts a comma or a dot, and only the last row may be blank.
    - Limits must increase.
  - `manualMethodErrorMap(errors: SettingsFieldError[]): ManualMethodErrors`
  - `ratesSummary(method, uiLocale, countryName: (code: string) => string): string`. For example `"Portugal 3,00 €–10,00 € · Spain 5,00 €"` (min–max per country, a single price when equal).
- Produces (`settingsForm.ts`): `marketInUseNames(errors: SettingsFieldError[]): string[]`.
- Produces (`integrationForm.ts`): a `markets` field is edited as `string[]` and sent as `string[]`. A required `markets` field that is empty on an active integration → `required`.

- [ ] **Step 1: Write the failing tests** covering:
  - each function above;
  - `applyToAllMarkets` copies and does not share arrays: mutating one country's row leaves the others unchanged;
  - `draftToManualMethodInput` for PT + ES with `[{upTo:'1',price:'3'},{upTo:'',price:'10'}]` → `rates.PT` = `[{upTo:1,price:300},{upTo:null,price:1000}]`;
  - a blank `upTo` on a non-last row → `rates.PT.0.upTo` `required`;
  - `'1,5'` → 1.5.

- [ ] **Step 2: Run** `npx vitest run tests/admin/ecommerce`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the tests. Expected: PASS.

- [ ] **Step 5: Commit** `feat(ecommerce): admin forms for per-market shipping rates`.

---

### Task 5: Admin UI

**Files:**
- Modify: `admin/src/ecommerce/components/settings/ManualMethodModal.tsx` (markets + brackets), `ManualMethodsTable.tsx` (prop `markets: string[]` instead of `zones`; summary via `ratesSummary`), `IntegrationConfigModal.tsx` (`markets` field: MultiSelect of the store markets with country names, plus a "Select all" button), `admin/src/ecommerce/pages/settings/IntegrationsSection.tsx` and `ShippingSettings.tsx` (pass `markets`, drop zones), `GeneralSettings.tsx` (MARKET_IN_USE message uses `marketInUseNames`), `admin/src/ecommerce/gateways/ecommerceSettingsGateway.ts` (drop zone calls)
- Delete: `ShippingZoneModal.tsx`, `ShippingZonesSection.tsx`, `usecases/settings/{fetch,create,update,delete}ShippingZone(s).ts`
- Modify: `admin/src/core/translations/en.json`, `pt.json`. Remove the `zones.*` keys; add the keys below.

**Interfaces:**
- Consumes: Task 4.
- UI contract (ManualMethodModal):
  - **Markets:** a "Markets" MultiSelect (country names from `countryOptions(uiLocale)`, store markets only), a "Select all markets" button, and a "Clear" button.
  - **Per selected market:** a section titled with the country name, holding a table of rows (Up to (kg) | Price (€) | remove). An "Add weight range" button adds a row. A hint reads "Leave 'Up to' empty on the last row for no limit."
  - **"Apply this table to all markets":** on each market section, uses `applyToAllMarkets`. It is shown only when 2 or more markets are selected.
  - **New market:** selecting a market starts it with `newBracketRows()`.
- Copy (en / pt):
  - `ecommerce.settings.manual.markets` "Markets" / "Mercados"
  - `.selectAll` "Select all markets" / "Selecionar todos os mercados"
  - `.addRange` "Add weight range" / "Adicionar intervalo de peso"
  - `.upTo` "Up to (kg)" / "Até (kg)"
  - `.price` "Price (€)" / "Preço (€)"
  - `.noLimit` "Leave 'Up to' empty on the last row for no limit. Heavier orders than the last range cannot use this method." / "Deixe 'Até' vazio na última linha para não ter limite. Encomendas mais pesadas do que o último intervalo não podem usar este método."
  - `.applyAll` "Apply this table to all markets" / "Aplicar esta tabela a todos os mercados"
  - `.selectAllMarkets` (integration field) "Select all" / "Selecionar todos"
  - `ecommerce.settings.errors.MARKET_IN_USE` "Remove these countries from the shipping methods first: {zones}." / "Retire primeiro estes países dos métodos de envio: {zones}." (keep the `{zones}` placeholder name, or rename it consistently in the code)
  - CTT `fields.markets` "Markets served" / "Mercados servidos"

- [ ] **Step 1: Implement** the components.
- [ ] **Step 2: Run** `npx tsc -p admin/tsconfig.json --noEmit && npx vitest run tests/admin`. Expected: PASS. Then `grep -rn -i "zone" admin/src/ecommerce | grep -v -i "timezone\|zoned"` must return nothing.
- [ ] **Step 3: Commit** `feat(ecommerce): shipping settings by market with weight ranges`.

---

### Task 6: Docs

**Files:**
- Modify: `docs/ecommerce/storefront-api.md` (the "shipping zones" paragraphs around lines 120–130). Countries come from the markets. Methods show only for countries they serve and when the cart weight is within their ranges. `shippingOptions: []` is not an error. The contract is unchanged.
- Modify: `docs/superpowers/specs/2026-11-11-ecommerce-design.md` §4.16. Replace Zones with "Markets → methods by market with weight ranges", recording the three decisions, marked **[Decisão, 2026-11-12]**.
- Modify: `docs/superpowers/plans/ecommerce-followups.md`. Remove the zone follow-ups, and add "variants with weight 0 make the order weight understate (admin hint?)".

- [ ] **Step 1: Edit the docs.**
- [ ] **Step 2: Commit** `docs(ecommerce): shipping by market and weight`.
