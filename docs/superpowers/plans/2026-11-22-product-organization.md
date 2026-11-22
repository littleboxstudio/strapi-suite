# Product Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add store-owned category trees, product types, tags, manual/automated collections, product vendor and variant compare-at price to the e-commerce module, with admin pages, admin API and Storefront API.

**Architecture:** New content types inside the e-commerce module (translations as `*-translation` types, like products). Pure rules (name keys, category tree checks, collection conditions, sorting) live in `domain/` modules without Strapi imports; Strapi services wrap them. Automated collections are kept up to date incrementally in the same request: a changed product is re-evaluated against every automated collection (`syncProducts`), a changed collection is re-evaluated over the catalogue in batches (`recalculate`).

**Tech Stack:** Strapi 5 plugin (TypeScript), React admin with @strapi/design-system v2, vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-product-organization-design.md` (approved; read it — every task's requirements include it).

**Conventions reference:** `/private/tmp/claude-501/-Users-filipemoraes-Projects-littlebox-plugins-strapi-suite/ceba2c25-6fa0-44d3-9e8a-9205d7c11e1b/scratchpad/conventions.md` (file paths, registration points, test helpers). Read it before any task.

## Global Constraints

- Single store; e-commerce module only; nothing outside it changes; existing storefront answers only gain fields.
- Money is integer cents, VAT included.
- Deleting a category, type, tag or collection never deletes products.
- Content types: folder `server/src/content-types/modules/ecommerce/<name>/`, `collectionName` `ltb_st_module_ecommerce_<snake plural>`, singularName `ltb-st-module-ecommerce-<name>`, registered in `content-types/index.ts` **and** `server/src/config/index.ts` (interface + defaults); `pluginOptions` as the product schema.
- Admin routes under `/admin/ecommerce/...`, storefront under `/ecommerce/storefront/...` (the module-active middleware needs `/ecommerce/`). Permissions: `productsRead` to read, `productsManage` to change (no new permissions).
- Errors: `EcommerceValidationError(message, [{ path, code }])`; state clashes (409) get their code added to `CONFLICT_CODES` in `controllers/modules/ecommerce/errors.ts`.
- Admin UI follows the module: sections (title row, actions top right), tables with an `EmptyNote` empty state, search inputs 38px (`SearchFieldHeight` or `style={{ height: 38 }}`), floating search dropdowns with `neutral150` row separators (as `components/promotions/TargetPicker.tsx`), header actions via `HeaderActions`, notices via `components/orders/NoticeBar`.
- Every admin text in both `admin/src/core/translations/en.json` and `pt.json` (pt with correct accents).
- Never import `@strapi/utils` in server code. Never log customer data.
- Commits: explicit paths only (never `git add -A`), never `.yalc/` or `yalc.lock`; message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; after each task's commit run `git branch -f main HEAD`. No push.
- Verification for every task: `npx vitest run <its test files>`; at the end of each task also `npx tsc -p server/tsconfig.json --noEmit`, `npx tsc -p admin/tsconfig.json --noEmit`, `npx tsc -p tests/tsconfig.json --noEmit` (whichever side changed).

## Review Focus

1. A product whose only matching variant is **inactive** must not enter an automated collection (variant rule = active variants only) — test in Task 3.
2. Changing **stock through an order** (not the product page) must add/remove the product from an "inventory ≤ 0" collection — test in Task 7.
3. A category condition `equals X` must include products in X's **sub-subcategories** (depth 3+) — test in Task 3.
4. Renaming a type/tag to a name differing only in **case or spaces** from another must be refused (`NAME_TAKEN`) — test in Task 5.
5. Storefront `category=<slug>` with a slug of **another locale** falls back to the default locale; an **inactive ancestor** makes it 404 — test in Task 9.

---

## Data model summary (used by all tasks)

New uids (config keys → singularName suffix):

| config key | name | notes |
|---|---|---|
| `category` | `product-category` | `parent` manyToOne self (inversedBy `children`), `children` oneToMany, `position` int default 0, `active` bool default true, `image` (url string, optional), `translations` oneToMany, `products` oneToMany (mappedBy `category`) |
| `categoryTranslation` | `product-category-translation` | `category`, `locale`, `name` (required), `slug` (required), `description` text, `seoTitle`, `seoDescription`; unique index (locale, slug) `ecommerce_category_tr_locale_slug_unique` |
| `productType` | `product-type` | `key` string required unique (index `ecommerce_product_type_key_unique`), `translations`, `products` oneToMany (mappedBy `productType`) |
| `productTypeTranslation` | `product-type-translation` | `productType`, `locale`, `name` |
| `tag` | `product-tag` | `key` unique (index `ecommerce_product_tag_key_unique`), `translations`, `products` manyToMany (mappedBy `tags`) |
| `tagTranslation` | `product-tag-translation` | `tag`, `locale`, `name` |
| `collection` | `collection` | `type` enum MANUAL/AUTOMATED, `sortOrder` enum (spec list), `active` bool default true, `image` (url string), `match` enum ALL/ANY default ALL, `conditions` json, `translations`, `members` oneToMany (collection-product) |
| `collectionTranslation` | `collection-translation` | `collection`, `locale`, `title` (required), `handle` (required), `description` text, `seoTitle`, `seoDescription`; unique (locale, handle) `ecommerce_collection_tr_locale_handle_unique` |
| `collectionProduct` | `collection-product` | `collection` manyToOne, `product` manyToOne (inversedBy `collectionMembers`), `position` int default 0; unique (collection, product) index `ecommerce_collection_product_unique` |

Product gains: `vendor` string (max 255), `category` manyToOne → category (inversedBy `products`), `productType` manyToOne → productType (inversedBy `products`), `tags` manyToMany → tag (inversedBy `products`), `collectionMembers` oneToMany → collectionProduct. Variant gains: `compareAtPrice` integer min 0 (nullable).

Ruling: the category/collection `image` is a plain URL string edited as a text field (the spec only says "optional image"; the product gallery's upload flow is product/variant-specific). Upload support can come later without changing the stored field.

---

### Task 1: Content types, config uids, fake DB many-to-many

**Files:**
- Create: the nine folders above under `server/src/content-types/modules/ecommerce/` (each `index.ts` + `schema.json`)
- Modify: `server/src/content-types/modules/ecommerce/product/schema.json`, `variant/schema.json`, `server/src/content-types/index.ts`, `server/src/config/index.ts`
- Modify: `tests/server/ecommerce/helpers/fakeDb.ts` (manyToMany relations: `FakeRelations` entry `[targetUid, joinTableName, 'manyToMany']`, `connect`/`set`/`disconnect` in create/update data, nested where on a manyToMany relation, populate)
- Test: create `tests/server/ecommerce/organizationContentTypes.test.ts`; update `contentTypes.test.ts` (`names` for product/variant), `schemaIndexes.test.ts` if it enumerates; `tests/server/ecommerce/helpers/fakeDb.test.ts` (or the existing fakeDb test file) for manyToMany

**Interfaces:**
- Produces: the uids/keys in the table; `createFakeDb` manyToMany support used by Tasks 4–9.

- [ ] Step 1: Write `organizationContentTypes.test.ts`: every new schema has the naming/pluginOptions conventions; relation pairs are symmetric (owner `mappedBy` ↔ target `inversedBy`, including `tags`↔`products` manyToMany and `parent`↔`children`); the unique indexes listed above exist; product has `vendor`, `category`, `productType`, `tags`, `collectionMembers`; variant has `compareAtPrice` (`type: integer`, `min: 0`, not required).
- [ ] Step 2: Write fake-DB tests: create a product with `tags: { connect: [1, 2] }`, `findMany({ where: { tags: { id: 2 } } })` returns it; `update` with `tags: { set: [3] }` replaces; `populate: { tags: true }` returns tag rows.
- [ ] Step 3: Run both — FAIL.
- [ ] Step 4: Add schemas, registrations, config uids; extend fakeDb.
- [ ] Step 5: Run the two new tests plus `contentTypes`, `schemaIndexes`, `schemaDuplicateKeys` tests — PASS; tsc server + tests.
- [ ] Step 6: Commit `feat(ecommerce): content types for categories, types, tags, collections; vendor and compare-at price`.

### Task 2: Pure rules — names, category tree

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/organization.ts`
- Test: `tests/server/ecommerce/domain/organization.test.ts`

**Interfaces — Produces:**
```ts
export const MAX_CATEGORY_DEPTH = 5;
export function nameKey(name: string): string; // trim, collapse inner whitespace to one space, toLowerCase(); '' when blank
export type CategoryNode = { id: number; parentId: number | null; position: number };
export function categoryDepth(nodes: CategoryNode[], id: number): number; // root = 1
export function subtreeIds(nodes: CategoryNode[], id: number): number[]; // id + all descendants, any depth
export function subtreeHeight(nodes: CategoryNode[], id: number): number; // 1 for a leaf
export function moveError(nodes: CategoryNode[], id: number, newParentId: number | null): 'CATEGORY_CYCLE' | 'CATEGORY_TOO_DEEP' | null;
export function categoryPath(nodes: CategoryNode[], id: number): number[]; // root … id
```
- [ ] Step 1: Tests: `nameKey('  Linen   Shirt ') === 'linen shirt'`; `nameKey('SHIRT') === nameKey('shirt')`; depth of a 3-level chain is 3; `subtreeIds` includes a depth-4 grandchild; moving a node under its own descendant → `'CATEGORY_CYCLE'`; moving a subtree of height 2 under a depth-4 node → `'CATEGORY_TOO_DEEP'` (4 + 2 > 5); under depth-3 → `null`; `categoryPath` returns root→leaf ids.
- [ ] Step 2–4: fail, implement, pass.
- [ ] Step 5: Commit `feat(ecommerce): category tree and name-key rules`.

### Task 3: Pure rules — collection conditions and sorting

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/collections.ts`
- Test: `tests/server/ecommerce/domain/collections.test.ts`

**Interfaces — Produces:**
```ts
export const MAX_COLLECTION_CONDITIONS = 60;
export type CollectionField = 'TITLE' | 'CATEGORY' | 'PRODUCT_TYPE' | 'TAG' | 'VENDOR' | 'PRICE' | 'COMPARE_AT_PRICE' | 'INVENTORY';
export type CollectionOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'gte' | 'lte';
export type CollectionCondition = { field: CollectionField; operator: CollectionOperator; value: string | number };
export type CollectionMatch = 'ALL' | 'ANY';
export const COLLECTION_SORTS = ['MANUAL','BEST_SELLING','TITLE_ASC','TITLE_DESC','PRICE_ASC','PRICE_DESC','NEWEST','OLDEST'] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export function operatorsForField(field: CollectionField): CollectionOperator[]; // text fields: eq,neq,contains,not_contains,starts_with,ends_with; CATEGORY/PRODUCT_TYPE/TAG: eq,neq; numeric: eq,neq,gt,lt,gte,lte
export function parseConditions(raw: unknown, match: unknown): { conditions: CollectionCondition[]; match: CollectionMatch; errors: { path: string; code: string }[] };
// paths: 'conditions' (required | too_many), 'conditions.<i>.field|operator|value' (invalid_field | invalid_operator | required | invalid_number), 'match' (invalid)
export type EvaluableProduct = {
  id: number; active: boolean; names: string[]; vendor: string | null;
  categorySubtreeOf: (categoryId: number) => boolean; // true when product's category is categoryId or below it
  productTypeId: number | null; tagIds: number[];
  variants: { active: boolean; price: number; compareAtPrice: number | null; stock: number }[];
};
export function productMatches(p: EvaluableProduct, conditions: CollectionCondition[], match: CollectionMatch): boolean;
export function referencedIds(conditions: CollectionCondition[]): { categoryIds: number[]; productTypeIds: number[]; tagIds: number[] };
export type SortableEntry = { id: number; name: string; priceMin: number; priceMax: number; unitsSold: number; position: number };
export function sortEntries<T extends SortableEntry>(entries: T[], sort: CollectionSort, locale: string): T[];
```
Rules: text comparisons case-insensitive; TITLE matches when **any** of `names` matches (for `neq`/`not_contains`: when **no** name equals/contains); VENDOR null behaves as `''`; numeric fields match when **at least one active** variant matches (`compareAtPrice: null` never matches); `TAG eq` = has tag, `neq` = has not; `CATEGORY eq` uses `categorySubtreeOf`, `neq` its negation; a product that is inactive or has no active variant never matches. Sort ties: newest (higher id) first; `MANUAL` by `position` asc; `BEST_SELLING` by `unitsSold` desc; `PRICE_ASC` by `priceMin`, `PRICE_DESC` by `priceMax`; titles with `localeCompare(locale)`.

- [ ] Step 1: Tests: each field × each allowed operator (one positive, one negative case); ALL vs ANY with two conditions; Review Focus 1 (only matching variant inactive → false); Review Focus 3 (`categorySubtreeOf` stub from Task 2 `subtreeIds` on a depth-4 chain → true); `parseConditions` errors (empty list for AUTOMATED → `conditions: required`; 61 → `too_many`; `PRICE` with `contains` → `invalid_operator`; `PRICE` value `'abc'` → `invalid_number`); `referencedIds`; each sort.
- [ ] Step 2–4: fail, implement, pass.
- [ ] Step 5: Commit `feat(ecommerce): collection condition and sorting rules`.

### Task 4: Products — vendor, compare-at price, organization fields

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/catalog.ts` (`ProductInput`/`VariantInput`, `validateProductInput`), `server/src/services/modules/ecommerce/products.ts`, `admin/src/ecommerce/types.ts` (mirror types/codes)
- Test: `tests/server/ecommerce/domain/catalog.test.ts`, `tests/server/ecommerce/products.test.ts`

**Interfaces:**
- Produces (server `ProductInput` additions): `vendor?: string | null; categoryId?: number | null; productTypeId?: number | null; productTypeName?: string | null; tagIds?: number[]; tagNames?: string[]; collectionIds?: number[]` (manual collections only); `VariantInput.compareAtPrice?: number | null`.
- `ProductDetail` additions: `vendor`, `categoryId`, `categoryPath: { id: number; name: string }[]`, `productTypeId`, `productTypeName`, `tags: { id: number; name: string }[]`, `collections: { id: number; title: string; type: 'MANUAL' | 'AUTOMATED' }[]`; variants include `compareAtPrice`.
- `list()` gains optional filters `{ categoryId?, productTypeId?, tagId?, vendor?, collectionId? }` (category includes subtree).
- New `products.ts` hook point: after a committed save/setActive/setVariantActive/delete, call `strapi.plugin(PLUGIN_ID).service('EcommerceCollectionService').syncProducts([id])` (service created in Task 7; until then guard with optional chaining so Task 4 tests pass with a stub).
- Error codes: `compare_at_not_above_price` at `variants.<i>.compareAtPrice`; `unknown` at `categoryId` / `productTypeId` / `tagIds.<i>` / `collectionIds.<i>`; `automated_collection` at `collectionIds.<i>` (an automated collection id given); vendor > 255 → `too_long` at `vendor`.
- `productTypeName` / `tagNames`: resolved through `EcommerceOrganizationService.ensureProductType(name)` / `ensureTags(names)` (Task 5) — reuse by `nameKey`, create in the default locale otherwise. When both id and name are given, the id wins.

- [ ] Step 1: Tests (domain): compare-at equal to price → error; below → error; null → ok; vendor 256 chars → `too_long`.
- [ ] Step 2: Tests (service): saving with categoryId/productTypeId/tagIds/vendor/compareAtPrice persists and `get()` returns them with `categoryPath` names in the default locale; unknown category → 400 path `categoryId`; `collectionIds` with an automated collection → `automated_collection`; `list({ categoryId: root })` includes a product in a grandchild category; `list({ tagId })`, `list({ vendor: 'ACME' })` case-insensitive exact; save calls the sync stub with `[id]`.
- [ ] Step 3–4: fail, implement (manual collection membership: diff `collection-product` rows for MANUAL collections only; new rows get `position = max+1`), pass.
- [ ] Step 5: Commit `feat(ecommerce): products carry vendor, category, type, tags, manual collections; variants a compare-at price`.

### Task 5: Organization service — categories, product types, tags (+ admin API)

**Files:**
- Create: `server/src/services/modules/ecommerce/organization.ts` (`EcommerceOrganizationService`), `server/src/controllers/modules/ecommerce/organization.ts` (`EcommerceOrganizationController`), `server/src/routes/ecommerce/admin-organization.ts`
- Modify: `services/index.ts`, `controllers/index.ts`, `routes/admin-api.ts`, `controllers/modules/ecommerce/errors.ts` (`CONFLICT_CODES` += `CATEGORY_HAS_CHILDREN`, `IN_USE_BY_COLLECTIONS`, `NAME_TAKEN`, `CATEGORY_CYCLE`, `CATEGORY_TOO_DEEP`)
- Test: `tests/server/ecommerce/organization.test.ts`, `tests/server/ecommerce/organizationRoutes.test.ts`, `tests/server/ecommerce/organizationController.test.ts`

**Interfaces — Produces (service):**
```ts
type Translations<T> = Record<string /*locale*/, T>;
type CategoryInput = { parentId: number | null; active: boolean; image: string | null;
  translations: Translations<{ name: string; slug?: string; description?: string | null; seoTitle?: string | null; seoDescription?: string | null }> };
listCategoryTree(locale?: string): Promise<CategoryTreeNode[]>; // { id, parentId, position, active, name, slug, productCount, children }
getCategory(id): Promise<CategoryDetail>; createCategory(input): Promise<{ id }>; updateCategory(id, input): Promise<void>;
moveCategory(id, { parentId: number | null; position: number }): Promise<void>; // siblings renumbered 0..n
deleteCategory(id): Promise<void>; // CATEGORY_HAS_CHILDREN (409) | IN_USE_BY_COLLECTIONS (409, detail = collection titles) ; products' category → null
listProductTypes({ page, search }), createProductType({ translations }), updateProductType(id, { translations }), deleteProductType(id);
listTags({ page, search }), createTag(...), updateTag(...), deleteTag(id);
ensureProductType(name: string): Promise<number>; ensureTags(names: string[]): Promise<number[]>;
listVendors(search?: string): Promise<string[]>; // distinct product vendors, for suggestions
```
- Slugs: like products (`slugify`, `resolveUniqueSlug` per locale) — generated from the name when absent, stable once set.
- Name rules: default-locale name required; `key = nameKey(defaultName)` unique → `NAME_TAKEN` (409) at `translations.<default>.name`.
- Delete type/tag/category used by an automated collection's conditions (`referencedIds`, scanning collections with `type: 'AUTOMATED'`) → `IN_USE_BY_COLLECTIONS`.
- After `moveCategory`: `EcommerceCollectionService.recalculateWhere({ categoryConditions: true })` (Task 7; guard as in Task 4).

**Routes (admin, all `/admin/ecommerce/...`):** `GET categories` (read), `GET categories/:id` (read), `POST categories`, `PUT categories/:id`, `PUT categories/:id/move`, `DELETE categories/:id`; `GET product-types`, `POST product-types`, `PUT product-types/:id`, `DELETE product-types/:id`; same four for `tags`; `GET vendors` (read). Writes use `productsManage`.

- [ ] Step 1: Service tests: tree build + product counts; depth limit via create and move; cycle refused; delete with children → `CATEGORY_HAS_CHILDREN`; delete keeps products (category null); delete referenced by an automated collection → `IN_USE_BY_COLLECTIONS`; type dedupe (`'  shirt '` after `'Shirt'` → `ensureProductType` returns the same id); Review Focus 4 (rename tag to `'SALE '` when `'sale'` exists → `NAME_TAKEN`); delete tag removes it from products, products remain.
- [ ] Step 2: Route test (copy `productRoutes.test.ts` pattern) listing every route with its action; controller test for 201/204/409 mapping.
- [ ] Step 3–4: fail, implement, pass.
- [ ] Step 5: Commit `feat(ecommerce): categories, product types and tags with admin API`.

### Task 6: Collections service — CRUD, manual members, admin API

**Files:**
- Create: `server/src/services/modules/ecommerce/collections.ts` (`EcommerceCollectionService`), `server/src/controllers/modules/ecommerce/collections.ts`, `server/src/routes/ecommerce/admin-collections.ts`
- Modify: registrations (`services/index.ts`, `controllers/index.ts`, `routes/admin-api.ts`), `CONFLICT_CODES` += `COLLECTION_IS_AUTOMATED`
- Test: `tests/server/ecommerce/collections.test.ts`, `collectionRoutes.test.ts`

**Interfaces — Produces:**
```ts
type CollectionInput = { type: 'MANUAL' | 'AUTOMATED'; sortOrder: CollectionSort; active: boolean; image: string | null;
  match: CollectionMatch; conditions: CollectionCondition[];
  translations: Record<string, { title: string; handle?: string; description?: string | null; seoTitle?: string | null; seoDescription?: string | null }> };
list({ page, search, locale }): { results: { id, title, handle, type, active, productCount }[], pagination };
get(id): CollectionDetail; create(input): { id }; update(id, input): void; // type cannot change after creation (error 'type': 'immutable'); MANUAL sort only for MANUAL ('sortOrder': 'invalid')
delete(id): void; // removes members, never products
listProducts(id, { page, locale }): { results: { productId, name, thumbnailUrl, position }[], pagination }; // in the collection's sort
addProducts(id, productIds: number[]): void; removeProducts(id, productIds): void; reorderProducts(id, productIds: number[]): void; // all three → COLLECTION_IS_AUTOMATED for automated; reorder requires a permutation of current members
bulkProducts(input: { productIds: number[] (≤100); action: 'addTag'|'removeTag'|'setCategory'|'setProductType'|'addToCollection'|'removeFromCollection'; value: number | null }): { updated: number };
```
Handles: unique per locale, generated from the title (`slugify`/`resolveUniqueSlug`). Conditions validated with `parseConditions`; an AUTOMATED create/update with changed `match`/`conditions` calls `recalculate(id)` (Task 7).

**Routes:** `GET/POST collections`, `GET/PUT/DELETE collections/:id`, `GET collections/:id/products`, `POST collections/:id/products` (add), `DELETE collections/:id/products` (body ids), `PUT collections/:id/products/order`, `POST products/bulk` (manage). Register literal sub-paths before `:id`.

- [ ] Step 1: Tests: create manual with handle generation and per-locale uniqueness; add/remove/reorder; automated add → `COLLECTION_IS_AUTOMATED`; type change refused; MANUAL sort on automated refused; delete keeps products; bulk addTag on 3 products; bulk > 100 ids → 400 `productIds: too_many`.
- [ ] Step 2–4: fail, implement, pass. Step 5: Commit `feat(ecommerce): collections with manual products and admin API`.

### Task 7: Automated collections — evaluation, sync hooks, preview, recalculate

**Files:**
- Modify: `collections.ts` (service), `products.ts` (replace the guarded calls with real ones), `stock.ts` (after an applied `move`, sync the variant's product), `organization.ts` (move → recalculate)
- Modify: controller + routes: `POST collections/preview` (manage; body `{ match, conditions, page }` → matching products, paginated, nothing stored), `POST collections/:id/recalculate` (manage)
- Test: `tests/server/ecommerce/collectionSync.test.ts`

**Interfaces — Produces:**
```ts
syncProducts(productIds: number[]): Promise<void>; // re-evaluate these products against every AUTOMATED collection; add/remove members; idempotent
recalculate(collectionId: number): Promise<{ added: number; removed: number }>; // whole catalogue in batches of 200 by id
recalculateWhere(filter: { categoryConditions: true }): Promise<void>;
preview(input: { match; conditions; page; locale }): Promise<{ results: { productId, name, thumbnailUrl }[]; pagination }>;
```
- Load per batch: products with translations(name), category id, productType id, tag ids, variants(active, price, compareAtPrice, stock) — one query per batch with populate (no N+1). Category subtree from one categories query + Task 2 `subtreeIds`.
- `stock.ts`: after `applied === true`, find the variant's product id and call `syncProducts([productId])` (same transaction context; failures there must not undo the stock move — catch and `strapi.log.warn` without customer data).

- [ ] Step 1: Tests: a product created matching `PRICE lt 1000` joins the collection; its price raised to 1500 via `products.update` leaves it; Review Focus 2 (stock via `stock().move({ type: 'ORDER_DEDUCT', ... })` to 0 adds it to an `INVENTORY lte 0` collection); tag added via update → joins `TAG eq`; product deactivated → removed; conditions changed → `recalculate` swaps members; preview returns matches without writing; `recalculate` twice → second returns `{ added: 0, removed: 0 }`.
- [ ] Step 2–4: fail, implement, pass. Step 5: Commit `feat(ecommerce): automated collections kept up to date incrementally`.

### Task 8: Best-selling units

**Files:**
- Modify: `collections.ts` (or a small `salesRanking.ts` service helper inside the same file) 
- Test: `tests/server/ecommerce/bestSelling.test.ts`

**Interfaces — Produces:** `unitsSoldByProduct(productIds: number[], now = new Date()): Promise<Map<number, number>>` — order lines of orders created in the last 90 days, `orderStatus !== 'CANCELLED'`, `paymentStatus in ['PAID','PARTIALLY_REFUNDED']`, `isGift !== true`, summing `quantity - returnedQuantity` by `productId`.

- [ ] Step 1: Tests: cancelled order ignored; PENDING ignored; 91-day-old ignored; returned units subtracted; gift lines ignored; `listProducts` of a BEST_SELLING collection orders by units.
- [ ] Step 2–4. Step 5: Commit `feat(ecommerce): best-selling order for collections`.

### Task 9: Storefront API

**Files:**
- Modify: `services/modules/ecommerce/storefrontCatalog.ts`, `controllers/modules/ecommerce/storefront.ts`, `routes/ecommerce/content-api-storefront.ts`, `docs/ecommerce/storefront-api.md`
- Test: `tests/server/ecommerce/storefrontCatalog.test.ts`, `storefrontRoutes.test.ts`, `storefrontController.test.ts`

**Interfaces — Produces:**
- `GET /categories?locale=` → `PublicCategory[]` tree `{ id, name, slug, parentId, position, image, children }` (active only; an inactive node hides its subtree).
- `GET /categories/:slug?locale=` → `{ ...PublicCategory without children, path: { id, name, slug }[] }`; 404 when unknown or it/any ancestor inactive.
- `GET /collections?locale=&page=&pageSize=` → `{ results: PublicCollection[], pagination }` (active, by title); `GET /collections/:handle?locale=` → `PublicCollection { id, title, handle, description, image, seoTitle, seoDescription }` (no `type`, `match`, `conditions`).
- `GET /products` new params: `category` (slug), `collection` (handle), `type` (id), `tag` (comma ids, any), `vendor` (exact, case-insensitive); combined with AND. Slug/handle resolved in the request locale then the default locale; unknown/inactive → 404 `NOT_FOUND`. `SORTS` += `name_desc`, `best_selling`, `oldest`; with `collection` and no `sort`, the collection's `sortOrder` (MANUAL → member position).
- Product list items and `PublicProduct` gain `vendor`, `category: { id, name, slug, path } | null`, `productType: { id, name } | null`, `tags: { id, name }[]`, `compareAtPriceMin: number | null` (list), variants `compareAtPrice: number | null` (only when > price).
- Same `limited(ctx, 'catalog', { sessionId: null })`.

- [ ] Step 1: Tests: tree hides inactive subtree; Review Focus 5 (pt request with an en slug → found; inactive ancestor → 404); collection by handle never contains `conditions`; filters each; `tag=1,2` any-of; `best_selling`, `oldest`, `name_desc`; compareAtPrice only when above price; routes list includes the 4 new routes.
- [ ] Step 2–4. Step 5: Update `storefront-api.md` (routes table, new params, answer fields, errors). Commit `feat(ecommerce): storefront categories, collections and catalogue filters`.

### Task 10: Admin — gateways, usecases, types, menu, Categories page, Types & tags page

**Files:**
- Create: `admin/src/ecommerce/organizationTypes.ts`, `admin/src/ecommerce/gateways/ecommerceOrganizationGateway.ts` (interface + Http; categories, types, tags, vendors, collections, bulk), usecases under `admin/src/ecommerce/usecases/organization/` (one class per call, `execute()`), `pages/organization/CategoryListPage.tsx` (tree table with indentation, Add top right, Edit, Delete, move up/down and "Move to…" parent select), `pages/organization/CategoryEditPage.tsx` (header Delete/Save; General: parent select, active, image URL; per-locale name/slug/description/SEO with `LocaleSwitcher`), `pages/organization/TypesTagsPage.tsx` (two sections, each a searchable table with rename-in-modal and Delete; errors `NAME_TAKEN`, `IN_USE_BY_COLLECTIONS` shown with the collection titles), `admin/src/ecommerce/utils/categoryTree.ts` (pure: flatten with depth, path label `"A > B > C"`, `descendantIds`)
- Modify: `admin/src/index.ts` (provide `ecommerceOrganizationGateway`), `EcommerceApp.tsx` (routes `categories`, `categories/new`, `categories/:id`, `collections`, `collections/new`, `collections/:id`, `types-tags`), `EcommerceLayout.tsx` `MENU` (+ `categories`, `collections`, `types-tags` after `products`), translations en/pt (`ecommerce.menu.*`, `ecommerce.organization.*`)
- Test: `tests/admin/ecommerce/categoryTree.test.ts`, `tests/admin/ecommerce/organizationTexts.test.ts` (every `ecommerce.organization.*` key exists in en and pt)

- [ ] Steps: tests → fail → implement → pass → tsc admin + tests → commit `feat(ecommerce): admin categories and types & tags pages`.

### Task 11: Admin — Collections list and edit

**Files:**
- Create: `pages/organization/CollectionListPage.tsx` (header "Create collection"; full-width 38px search; table title / type badge / products / active; pagination; empty state), `pages/organization/CollectionEditPage.tsx` (header Delete/Save; sections General (per-locale title, handle, description; active; image URL), Type (radio on create, read-only afterwards), Products (manual: floating product search to add, table with drag to reorder — reuse the gallery's drag approach — Remove, empty state), Conditions (automated: "All conditions"/"Any condition" radio, rows field/operator/value with pickers for category (tree select), type, tag; plain-words sentence via a pure describer; live preview table of matching products, debounced 400 ms, with count), Sorting (select; MANUAL only for manual), SEO (per locale)), `admin/src/ecommerce/utils/collectionForm.ts` (pure: form ⇄ input, validation mirroring `parseConditions` paths, `describeCollectionConditions(form, t, labels)`, `operatorsForField`)
- Test: `tests/admin/ecommerce/collectionForm.test.ts`

- [ ] Steps: tests (round-trip, validation paths, operators per field, sentence en/pt) → implement → pass → tsc → commit `feat(ecommerce): admin collections`.

### Task 12: Admin — Product organization section, vendor, compare-at price

**Files:**
- Create: `components/products/ProductOrganizationSection.tsx` (Category picker: popover with search + tree browse, shows full path, Change/Remove; Product type: searchable select with "Create “…”" option; Vendor: text with suggestions from `GET vendors`; Collections: multi-select of MANUAL collections + read-only list of automated ones with an "Automated" badge; Tags: token input with autocomplete, new names kept as `tagNames`)
- Modify: `pages/ProductEditPage.tsx` (new section after Information), `utils/productForm.ts` (form fields + `buildProductInput` + `productFormFromDetail`), `components/VariantModal.tsx` + `utils/variantDraft.ts` (Compare-at price field next to Price; client check "must be above the price"), `components/VariantsTable.tsx` (show compare-at struck when set), translations
- Test: `tests/admin/ecommerce/productForm.test.ts`, `variantDraft.test.ts`

- [ ] Steps: tests (form round-trip with organization fields; tagNames vs tagIds; compare-at parse and error) → implement → pass → tsc → commit `feat(ecommerce): product organization section; vendor and compare-at price in the admin`.

### Task 13: Whole-suite verification and docs

- [ ] Run `npx vitest run` (full), the three tsc projects; fix any failure in the task that owns it.
- [ ] Manual check in the test Strapi (`~/Projects/littlebox-plugins/strapi/backend-base`, port 1337) without saving data that matters: open Categories, Collections, Types & tags, a product's organization section.
- [ ] Commit any doc touch-ups `docs(ecommerce): product organization`.
