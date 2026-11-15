# DPD Portugal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **DPD Portugal** carrier module (DPD Express and DPD Pickup, each switched on its own, priced by market and weight bracket), a storefront pickup-point search, pickup checkout, DPD shipments and labels, and a **Portugal - Ilhas** market (`PT-ISL`).

**Architecture:**
- A new carrier provider `dpd-portugal`. Its definition holds the credentials and sender data, and its config holds the two services (`active`, name per locale, tax, rates per market).
- The adapter quotes locally from those rates and calls DPD only to create shipments, fetch labels and search pickup points. The DPD HTTP client and the SOAP pickup client are thin and injectable.
- Markets become "market codes": an ISO country, or `PT-ISL`. One pure function maps an address to its market.
- The order gains a `pickupPoint` JSON field.

**Tech Stack:** Strapi 5 plugin (TypeScript server, React admin with `@strapi/design-system` v2), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-dpd-portugal-design.md` (binding, Portuguese). "spec §N" means a section of that file.

## Global Constraints

- Non-ecommerce modules must not change. Manual shipping and CTT behave exactly as today in a store **without** `PT-ISL` in its markets (spec §8).
- Secrets (`clientSecret`, `password`, `pickupKey`) are stored encrypted and masked, as other `secret` provider fields.
- Never log credentials, tokens, the pickup key, names, addresses, phones or e-mails. Log only an error code and the order id.
- Tests never call DPD. HTTP and SOAP go through injected functions or `timedFetch` mocks.
- Admin texts exist in both `admin/src/core/translations/en.json` and `pt.json` (Portuguese with correct accents). Keys live under `littlebox-strapi-suite.ecommerce.…`.
- Commit with explicit paths (never `git add -A`). Never touch `.yalc/` or `yalc.lock`. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks: `npx tsc -p server/tsconfig.json --noEmit`, `npx tsc -p admin/tsconfig.json --noEmit`, `npx tsc -p tests/tsconfig.json --noEmit`, `npx vitest run`.
- Error codes are exactly: `DPD_AUTH_FAILED`, `DPD_SHIPMENT_FAILED`, `PICKUP_NOT_AVAILABLE`, `INVALID_POSTAL_CODE`, `PICKUP_SEARCH_FAILED`, `PICKUP_POINT_INVALID`, `PICKUP_POINT_REQUIRED` (spec §5, §9), and `PICKUP_ADDRESS_LOCKED` (order editing: the address of a Pickup order changes only by choosing another point, Task 9).

## Rulings

1. **Market code.** `PT-ISL` is the only non-country market. `marketOf(country, postalCode, storeMarkets)` returns `'PT-ISL'` when `country === 'PT'`, `postalCode` (digits only) starts with `9`, **and** `storeMarkets.includes('PT-ISL')`. Otherwise it returns `country`. `marketCountry(market)` returns `'PT'` for `PT-ISL`, otherwise the market itself.
2. **Where the market is used.** Shipping prices and availability only: `EcommerceShippingService.quote`, `servedCountries` (renamed in meaning to "served markets"; the name is kept), and every check that compares an address with served markets (order editing `COUNTRY_NOT_SERVED`, manual order, checkout). VAT, Moloni, and stored addresses keep the ISO country.
3. **Address-country validation.** Where an address country is checked against the store markets, the allowed set is `markets.map(marketCountry)`. `PT-ISL` therefore allows `PT`.
4. **Services storage.** The `dpd-portugal` integration config gets `services: { EXPRESS: DpdService; PICKUP: DpdService }`, where `DpdService = { active: boolean; name: Record<string,string>; tax: number; rates: MarketRates }`. They are saved through a dedicated settings method, not through generic definition fields. `ProviderField` gains no new type.
5. **Activation rule (spec §3.2).**
   - Saving services with none active sets the integration `active = false`.
   - Activating the integration with no active service fails with path `services`, code `NO_ACTIVE_SERVICE`.
   - Activation also requires `accountHome` when EXPRESS is active, and `accountShop` + `pickupKey` when PICKUP is active (code `required`).
6. **Served markets of DPD** = union of `Object.keys(service.rates)` of active services ∩ store markets. `quote`/`servedCountries` take this path for `dpd-portugal` instead of `config.markets`.
7. **Quote.** The DPD adapter `quote` is local: for each active service with `rates[market]` and a bracket that fits `orderWeightGrams(items)`, it emits `{ providerId: 'dpd-portugal', serviceId: 'EXPRESS'|'PICKUP', name: name[locale] || name[defaultLocale] || 'DPD Express'|'DPD Pickup', price, tax }`. The PICKUP option carries `requiresPickupPoint: true`. `ShippingOption` gains optional `requiresPickupPoint?: boolean`, and `pickOption` keeps it when it is `true`.
8. **Shipping old orders (spec §7).** `EcommerceShippingService.carrierFor(providerId, { forShipment: true })` accepts an inactive `dpd-portugal` integration when the credentials are present (auth endpoint, expedition endpoint, client id, secret, user, password). Quotes keep requiring active.
9. **Pickup point on the order.** The order gets `pickupPoint` (json, nullable): `{ id, name, address, address2, postalCode, city, country, customerAddress: Address }`.
10. **Label.** The shipment gets `labelRef` (text, private: never serialized to the admin or storefront). `CarrierShipmentResult` gains optional `labelRef?: string`. `getLabel(externalId, rt, opts, labelRef?)` gets it as a 4th argument. DPD `getLabel` downloads `labelRef` with `timedFetch`.
11. **Cancel.** The DPD adapter has no `cancelShipment`. For a provider without `cancelShipment`, shipment cancel marks the shipment CANCELLED locally. The result carries `carrierCancelled: false`, and the admin shows the notice key `ecommerce.orders.shipments.cancel.manualCarrier` ("Cancel it also on the carrier's portal." / "Anule-o também no portal da transportadora.").
12. **SOAP client.** No new dependency. POST a SOAP 1.1 envelope with `fetch` to the configured endpoint (with `?wsdl` stripped). The defaults are namespace `http://mypudo.pickup-services.com/` and SOAPAction `http://mypudo.pickup-services.com/GetPudoList`. First try to read the public WSDL (`http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl`) to confirm both values, and use what it says. Parse the response with a small tag reader; no XML library.
13. **Pickup cache.** In-memory `Map<postalCode, {points, at}>` with a 10-minute TTL, inside the pickup service, cleared by a test helper.
14. **Weights.** Variant `weight` is in kilograms; `weightGrams` comes from `orderWeightGrams` (×1000). DPD `encomenda_peso_envio` = `max(0.1, grams/1000)` formatted with up to 3 decimals and a dot.
15. **Text limits.** Address is split into two 32-character parts (the 2nd one dropped if empty). Names are cut at 64. The postal code is formatted `NNNN-NNN` when it has 7 digits.

## Review Focus

1. A PT island postcode in a store **without** `PT-ISL` must still get PT prices (manual and DPD). Test in Task 1 and Task 4.
2. An order whose DPD service was later switched off must still ship, but the service must not be offered in quotes. Test in Task 4 and Task 8.
3. A checkout with DPD Pickup and no `pickupPointId`, or with an id the DPD search does not return, must not create an order and must not consume stock or promotions. Test in Task 7.
4. Removing a market from the store while a DPD rate table uses it must be refused (`MARKET_IN_USE`), as for manual methods. Test in Task 2.
5. Secrets never come back in GET responses. A save with an empty secret keeps the stored one. Test in Task 2.

---

### Task 1: Market codes and Portugal - Ilhas

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/markets.ts`
- Modify: `server/src/services/modules/ecommerce/settings.ts` (market validation accepts `PT-ISL`), `server/src/services/modules/ecommerce/shipping.ts` (`quote` and `servedCountries` use the market), `server/src/services/modules/ecommerce/orders.ts` and `orderEditing.ts` (address checks via `marketCountry` / `marketOf`), `storefrontCheckout.ts` and `orderPricing.ts` (pass `postalCode` into quote requests where it is missing)
- Modify admin: `admin/src/ecommerce/utils/settingsForm.ts` (market options include `PT-ISL`), `MarketPicker.tsx`/`MarketsTable.tsx` names via translation `ecommerce.settings.markets.names.PT-ISL` = "Portugal - Islands" / "Portugal - Ilhas", and `ecommerce.settings.markets.select` = "Choose a market" / "Escolha um mercado". Also the hint `store.markets.hint` ("Countries and regions where the store sells…" / "Países e regiões onde a loja vende…") and `markets.count` (`# market`/`# markets`, `# mercado`/`# mercados`).
- Test: `tests/server/ecommerce/domain/markets.test.ts`, and additions to the existing shipping and settings tests.

**Interfaces:**
- Produces: `export const ISLANDS_MARKET = 'PT-ISL'`; `export function marketOf(country: string, postalCode: string | null | undefined, storeMarkets: readonly string[]): string`; `export function marketCountry(market: string): string`; `export function isMarketCode(code: string): boolean` (ISO-2 from the existing country list, or `PT-ISL`).

- [ ] **Step 1: Write the failing tests.**
  - `marketOf('PT','9500-123',['PT','PT-ISL']) === 'PT-ISL'`
  - `marketOf('PT','9500-123',['PT']) === 'PT'`
  - `marketOf('PT','1000-001',['PT','PT-ISL']) === 'PT'`
  - `marketOf('ES','9000',['ES','PT-ISL']) === 'ES'`
  - `marketCountry('PT-ISL') === 'PT'`
  - Shipping: a manual method with rates `{ PT: [...], 'PT-ISL': [...] }` quotes the PT-ISL price for `{country:'PT', postalCode:'9000-001'}` when the store markets include `PT-ISL`, and the PT price when they do not.
  - Settings: `markets: ['PT','PT-ISL']` saves; `['XX-ISL']` fails `invalid_country`.
- [ ] **Step 2: Run them; they fail.** `npx vitest run tests/server/ecommerce/domain/markets.test.ts`
- [ ] **Step 3: Implement.** Find every `quote(` caller and every country-vs-markets comparison (`grep -rn "markets\|servedCountries\|COUNTRY_NOT_SERVED" server/src/services/modules/ecommerce`). Route each one through `marketOf`/`marketCountry` per Rulings 2 and 3. Inside `quote`, compute the market once from `req.country`/`req.postalCode` and use it for the market check, manual brackets and carrier `config.markets`.
- [ ] **Step 4: All checks pass** (Global Constraints).
- [ ] **Step 5: Commit** `feat(ecommerce): Portugal - Ilhas market for shipping prices`.

### Task 2: DPD Portugal provider definition and settings

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/definitions/dpd-portugal.ts`, `server/src/services/modules/ecommerce/domain/dpdServices.ts`
- Modify: `providers/registry.ts` (register the definition), `settings.ts` (services get/save, activation rule, `MARKET_IN_USE` for DPD rates, masking), the admin settings controller and routes, following the manual-methods endpoints
- Test: `tests/server/ecommerce/providers/dpdPortugal.settings.test.ts`, `tests/server/ecommerce/domain/dpdServices.test.ts`

**Interfaces:**
- Definition `id: 'dpd-portugal'`, `category: 'carrier'`, `name: 'DPD Portugal'`, `exclusive: false`. Fields, with label keys `ecommerce.settings.providers.dpd-portugal.fields.<key>`:
  - `authEndpoint`, `expeditionEndpoint`, `clientId`, `username`: `string`, required
  - `clientSecret`, `password`: `secret`, required
  - `accountHome`, `accountShop`: `string`, not required
  - `pickupEndpoint`: `string`, default `http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl`
  - `pickupKey`: `secret`, not required
  - `senderName`, `senderAddress`, `senderPostalCode`, `senderCity`, `senderPhone`, `senderEmail`: `string`, required
- `domain/dpdServices.ts` produces:
  - `export type DpdServiceId = 'EXPRESS' | 'PICKUP'`
  - `export type DpdService = { active: boolean; name: Record<string,string>; tax: number; rates: MarketRates }`
  - `export type DpdServices = Record<DpdServiceId, DpdService>`
  - `export const DPD_SERVICE_DEFAULTS: DpdServices` (both inactive; names `{ en: 'DPD Express', pt: 'DPD Express' }` and `{ en: 'DPD Pickup', pt: 'DPD Pickup' }`; tax 23; rates `{}`)
  - `export function normalizeDpdServices(input: unknown, markets: ReadonlySet<string>, errors: FieldError[]): DpdServices` (reuses the manual `normalizeMarketRates`)
  - `export function dpdActivationIssues(services: DpdServices, config: Record<string,unknown>, hasSecret: (k: string) => boolean): FieldError[]`
  - `export function dpdServedMarkets(services: DpdServices, storeMarkets: readonly string[]): string[]`
- Settings service produces: `getDpdServices(): Promise<DpdServices>`; `saveDpdServices(input: unknown): Promise<{ services: DpdServices; active: boolean }>`. Routes: `GET`/`PUT /ecommerce/settings/carriers/dpd-portugal/services`, with the same permission as editing integrations.

- [ ] **Step 1: Failing tests.**
  - Saving services with both inactive turns an active integration inactive.
  - Activating with no active service → `NO_ACTIVE_SERVICE`.
  - PICKUP active without `accountShop` or `pickupKey` → `required` on each.
  - Rates for a non-store market → the manual-method validation code.
  - Removing a store market used by a DPD rate table → `MARKET_IN_USE` with detail `DPD Portugal`.
  - GET never returns `clientSecret`/`password`/`pickupKey` values.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** per Rulings 4, 5 and 6.
- [ ] **Step 4: Checks pass.**
- [ ] **Step 5: Commit** `feat(ecommerce): DPD Portugal carrier settings with Express and Pickup services`.

### Task 3: DPD Portugal settings screen

**Files:**
- Create: `admin/src/ecommerce/components/settings/DpdServicesSection.tsx`, gateway and usecases `fetchDpdServices` / `saveDpdServices` (follow `ManualMethodsTable` and its gateway)
- Modify: `IntegrationCard.tsx`/`IntegrationConfigModal.tsx` so the `dpd-portugal` card shows the services section, the way the `manual` card holds its methods table; translations `en.json`/`pt.json` for every field label, the services, and the errors `NO_ACTIVE_SERVICE`
- Test: `tests/admin/ecommerce/dpdServices.test.ts` (form helpers), translation key test

**Interfaces:** consumes Task 2 routes and types.

- [ ] **Step 1: Failing tests** for a pure helper `dpdServicesForm.ts`: form ↔ `DpdServices` round trip, and `activeServiceCount`.
- [ ] **Step 2: Run; fail.**
- [ ] **Step 3: Implement.**
  - Each service row: an Active toggle, the name per locale, the tax, and the rate editor (reuse `BracketRows`/`ManualMethodModal` pieces).
  - Switching both services off shows that the module will be deactivated, then the card reflects `active: false` from the response.
- [ ] **Step 4: Checks pass.** Then verify in the test Strapi with the browser: open Settings → Shipping → DPD Portugal, change nothing, cancel.
- [ ] **Step 5: Commit** `feat(ecommerce): DPD Portugal settings screen`.

### Task 4: DPD quoting

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/carriers/dpdPortugal.ts` (adapter; quote only in this task)
- Modify: `providers/carriers/index.ts`, `shipping.ts` (`ShippingOption.requiresPickupPoint`, `pickOption`, served markets of DPD, `carrierFor(providerId, opts?: { forShipment?: boolean })`), admin `orderTypes.ts` `ShippingOption`
- Test: `tests/server/ecommerce/providers/dpdPortugal.quote.test.ts`

**Interfaces:**
- Produces: `dpdPortugalAdapter: CarrierAdapter`. The adapter's `quote(req, rt)` reads `rt.config.services` and needs the market. `ShippingQuoteRequest` gains optional `market?: string`, which `quote` fills before calling adapters.

- [ ] **Step 1: Failing tests.**
  - Both services active with PT rates → two options; PICKUP has `requiresPickupPoint: true`.
  - EXPRESS inactive → only PICKUP.
  - Weight above the last bracket → no option.
  - `PT-ISL` rates are used only when the store has `PT-ISL` (Review Focus 1).
  - `carrierFor('dpd-portugal', { forShipment: true })` works with the integration inactive but credentials set. Without the flag it throws `CARRIER_NOT_CONFIGURED` (Review Focus 2).
- [ ] **Step 2–4:** run, implement per Rulings 6, 7 and 8, checks pass.
- [ ] **Step 5: Commit** `feat(ecommerce): DPD Express and Pickup prices in shipping quotes`.

### Task 5: DPD API clients

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/carriers/dpd/client.ts` (auth + expedition + label download), `dpd/pickupClient.ts` (SOAP `GetPudoList`), `dpd/payload.ts` (pure body builder and normalizers)
- Modify: `dpdPortugal.ts` adapter (`createShipment`, `getLabel`), `definitions/dpd-portugal.ts` `testConnection`, `providers/carriers/types.ts` (Ruling 10 fields; `CarrierShipmentRequest` gains `pickupPoint?: { id: string; name: string }`, `parcels?: number`, `weightGrams?: number`)
- Test: `tests/server/ecommerce/providers/dpdPortugal.client.test.ts`, `dpdPortugal.payload.test.ts`

**Interfaces:**
- `payload.ts`:
  - `buildExpeditionBody(input: DpdExpeditionInput): Record<string, unknown>`. Exact DPD field names are in spec §2.1.
  - `DpdExpeditionInput = { service: DpdServiceId; subAccount: string; sender: {...}; recipient: { name; phone?; email; address; postalCode; city; country }; pickupPointId?: string; reference: string; date: string /* yyyy-MM-dd */; weightGrams: number; parcels: number }`
  - `normalizePudoItems(raw: unknown): PickupPoint[]`
  - `PickupPoint = { id; name; address; address2: string|null; postalCode; city; country: 'PT'; openingHours: { day: number; from: string; to: string }[] }`
- `client.ts`:
  - `dpdToken(rt, opts): Promise<string>` (throws `EcommerceCarrierError('DPD_AUTH_FAILED')` unless `status_code === 200`)
  - `dpdCreateExpedition(rt, body, opts): Promise<{ trackingCode: string; labelUrl: string }>` (throws `DPD_SHIPMENT_FAILED`; a network timeout is thrown as uncertain, as `cttExpresso`/`timedFetch` do)
- `pickupClient.ts`: `searchPudo(endpoint: string, key: string, postalCode: string, opts): Promise<PickupPoint[]>` (throws `PICKUP_SEARCH_FAILED` on transport or `RESPONSE.ERROR`)
- Adapter `createShipment` returns `{ externalId: trackingCode, trackingCode, trackingUrl: 'https://tracking.dpd.pt/track-and-trace?reference=' + trackingCode, cost: null, labelAvailable: true, labelRef: labelUrl }`. The sub-account is `accountHome` for EXPRESS and `accountShop` for PICKUP.

- [ ] **Step 1: Failing tests.**
  - The body for EXPRESS: `sub_account.code` = accountHome, `destinatario_usar_endereco_pickup: false`, `recipient_pickup_store.number: ''`.
  - The body for PICKUP: accountShop, `true`, the pudo id, and the `pickup_store_*` fields.
  - Weight 250 g → `"0.25"`; 20 g → `"0.1"`.
  - A 70-character address is split 32/32.
  - Postal code `1000001` → `1000-001`.
  - Auth `status_code: 401` → `DPD_AUTH_FAILED`.
  - A SOAP response fixture with two `PUDO_ITEM`s → normalized points with hours. A fixture with `ERROR` → `PICKUP_SEARCH_FAILED`.
  - No secret value appears in thrown messages.
- [ ] **Step 2–4:** run, implement per Rulings 12, 14 and 15, checks pass.
- [ ] **Step 5: Commit** `feat(ecommerce): DPD Portugal API and pickup point clients`.

### Task 6: Pickup point search (service + storefront + admin endpoint)

**Files:**
- Create: `server/src/services/modules/ecommerce/pickupPoints.ts` (service `EcommercePickupPointService`, registered as other services)
- Modify: `routes/ecommerce/content-api-storefront.ts` (`route('GET', '/shipping/pickup-points', 'pickupPoints')`), the storefront controller, an admin route `GET /ecommerce/orders/pickup-points?postalCode=` (permission `orders.manage`), `docs/ecommerce/storefront-api.md`
- Test: `tests/server/ecommerce/pickupPoints.test.ts`, route tests

**Interfaces:**
- `search(input: { postalCode: string; country?: string }): Promise<PickupPoint[]>`. It validates `^\d{4}-?\d{3}$` → `INVALID_POSTAL_CODE`, and the country must be `PT` (default). It throws `PICKUP_NOT_AVAILABLE` unless the integration has PICKUP active and the address's market is served by PICKUP rates. It uses the cache (Ruling 13).
- `findPoint(postalCode: string, id: string): Promise<PickupPoint | null>` (cache first, then search).
- `__clearPickupCacheForTests()`.
- Storefront response: `{ points: PickupPoint[] }`. Errors use the existing storefront error shape with the codes above.

- [ ] **Step 1–5:** tests cover validation, not-available, the cache hit (the client is called once for two searches within 10 minutes), and a failure mapped to `PICKUP_SEARCH_FAILED`. Implement, check, then commit `feat(ecommerce): pickup point search for the storefront and the admin`.

### Task 7: Pickup checkout and the order's pickup point

**Files:**
- Modify: `content-types/modules/ecommerce/order/schema.json` (`pickupPoint` json); `storefrontCheckout.ts` (`StorefrontOrderInput.pickupPointId?: string`, validation, address replacement); `orders.ts` (persist, order view exposes `pickupPoint` without `customerAddress` in storefront views); admin `orderTypes.ts`; `docs/ecommerce/storefront-api.md`
- Test: `tests/server/ecommerce/storefront.pickupCheckout.test.ts`, content-type test

**Interfaces:**
- Consumes `EcommercePickupPointService.findPoint`.
- Rules (spec §5.2):
  - PICKUP chosen and no id → `PICKUP_POINT_REQUIRED` (path `pickupPointId`). An unknown id → `PICKUP_POINT_INVALID`. A search failure → `PICKUP_SEARCH_FAILED`. All three are checked **before** the order transaction.
  - Shipping address saved: `{ firstName, lastName, phone }` from the input shipping address, `company` = point name, address/address2/postalCode/city/country from the point.
  - `billingAddress` = input `billingAddress` ?? input `shippingAddress` (the customer's).
  - `pickupPoint = { ...point fields, customerAddress: input.shippingAddress }`.
- A non-pickup method with a `pickupPointId` ignores it.

- [ ] **Step 1: Failing tests.**
  - Missing id → no order row, no stock movement, no promotion usage (Review Focus 3).
  - An invalid id → same.
  - A valid id → shipping address = point, billing = customer, `pickupPoint` stored.
  - The quote endpoint lists PICKUP with `requiresPickupPoint`.
- [ ] **Step 2–5:** run, implement, check, commit `feat(ecommerce): DPD Pickup checkout with the pickup point as the delivery address`.

### Task 8: DPD shipments from the admin

**Files:**
- Modify: `content-types/.../shipment/schema.json` (`labelRef` text, private); `shipments.ts`:
  - pass `pickupPoint`, `parcels` and `weightGrams` (the sum of the shipped units' variant weights) into `CarrierShipmentRequest`;
  - store `labelRef`;
  - call `getLabel` with `labelRef`;
  - use `carrierFor(..., { forShipment: true })` for create, retry and label;
  - cancel without `cancelShipment` per Ruling 11.
- Modify: the Ship input (`parcels?: number`, an integer 1–99, default 1); admin `ShipOrderModal.tsx` (a Parcels field when the order's provider is `dpd-portugal`); `ShipmentsSection.tsx` (cancel notice); translations
- Test: `tests/server/ecommerce/shipments.dpd.test.ts`

- [ ] **Step 1: Failing tests.**
  - A DPD Express ship sends subAccount home, the parcels and the weight. The shipment becomes ACTIVE with tracking, the URL, `labelAvailable` and the stored `labelRef`. `labelRef` is absent from the shipment view.
  - A PICKUP ship sends the pudo id.
  - A ship with the DPD integration inactive but configured still works (Review Focus 2).
  - Cancel marks CANCELLED with `carrierCancelled: false`.
  - CTT requests are unchanged (existing tests stay green).
- [ ] **Step 2–5:** run, implement, check, browser check of the Ship modal on a DPD order if one exists (do not submit), commit `feat(ecommerce): DPD shipments, labels and local cancel`.

### Task 9: Pickup point in the admin order

**Files:**
- Create: `admin/src/ecommerce/components/orders/PickupPointPicker.tsx` (postal code search → list → choose), gateway and usecase `searchPickupPoints`
- Modify:
  - `ShipmentsSection.tsx`: show the point (name and id) by the delivery address;
  - `ShippingAddressModal.tsx`: read-only with a "Change pickup point" button while the order has a `pickupPoint`;
  - the manual-order flow and the shipping-method change in order editing (`orderEditing.ts` and its modal): choosing an option with `requiresPickupPoint` opens the picker, and the server applies the point address as in Task 7;
  - leaving PICKUP restores `pickupPoint.customerAddress` and clears `pickupPoint`;
  - translations.
- Test: `tests/server/ecommerce/orders.editPickup.test.ts`, `tests/admin/ecommerce/pickupPoint.test.ts`

**Interfaces:**
- Order editing and manual order inputs gain `pickupPointId?: string`, validated with `findPoint` (same codes as Task 7).

- [ ] **Step 1: Failing tests.**
  - Changing the method to PICKUP without an id → `PICKUP_POINT_REQUIRED`.
  - With an id → the address is replaced and `customerAddress` is kept.
  - Changing away → the address is restored and the point cleared.
  - Editing the address of a pickup order → `PICKUP_ADDRESS_LOCKED`. Add this code to the Global Constraints list of admin error messages.
- [ ] **Step 2–5:** run, implement, check, browser check (no saves), commit `feat(ecommerce): pickup point in the admin order`.

### Task 10: Docs and final pass

- [ ] Update `docs/ecommerce/storefront-api.md` (pickup-points endpoint, `requiresPickupPoint`, `pickupPointId`, the error codes) if earlier tasks did not finish it.
- [ ] Spec `2026-11-11-ecommerce-design.md` §4.16: one paragraph pointing to `PT-ISL` and the DPD spec.
- [ ] Full checks, then commit `docs(ecommerce): DPD Portugal and Portugal - Ilhas in the storefront contract`.
