# Product organization — categories, types, collections, tags, compare-at price

Status: draft for the store owner's approval (2026-11-22); reviewed by a builder check; deletion of
referenced entities decided by the owner. Based on the owner's written request in chat
plus their answers: compare-at price is created; names and texts the shopper sees are
translated; categories are the store's own tree for navigation (no external taxonomy, no Shopify).

Vendor removed by the owner on 2026-11-22.

## Intent

The catalogue today has products (active flag, translations: name, slug, short/long description,
images) and variants (SKU, price, VAT, stock, dimensions, position, translations, images). There is no
way to organize products for the storefront. This adds four independent ways to organize them, plus
one catalogue field the automated collections need:

| Concept | What it is for | Per product |
|---|---|---|
| **Category** | The store's navigation tree (Clothing > Shirts > Linen) | 0 or 1 |
| **Product type** | A flat, merchant-defined kind (e.g. "Shirt", "Gift card") used for search, filters and rules | 0 or 1 |
| **Collection** | A cross-cutting group for the storefront ("New in", "Sale", "Summer"), manual or automated | 0..n |
| **Tag** | Free labels for search, filters and rules | 0..n |
| **Compare-at price** | The "was" price of a variant, shown struck through | per variant, optional |

The storefront (headless, through the existing Storefront API) uses categories for navigation and
collections for curated pages; both are listed with pagination and sorting.

## Constraints

- Single store (single tenant). Nothing per-store / multi-tenant.
- E-commerce module only; nothing outside it changes. Existing storefront answers keep their shape
  (fields are only added).
- Money is integer cents, VAT included (as every price in the module).
- Deleting a category, type, collection or tag never deletes products.
- Admin pages follow the existing e-commerce admin: Strapi design system v2, sections with the title
  row and actions on the right, tables with an empty state in the darker box, search bars 38px,
  floating search dropdowns with `neutral150` separators, header actions (Delete / Save), notices in
  the notice colours (#43311a, white text).
- No new external services, queues or workers.

## Anti-goals

- No integration with Shopify or any external taxonomy.
- No per-category attributes editor (the data model only leaves room for it later).
- No navigation menu builder; collections have no hierarchy.
- Automated collections never accept manual product changes.

## Data model (new content types, all inside the e-commerce module)

Translations follow the product pattern: a `*-translation` content type with `locale` and the texts;
the store's configured locales and default-locale fallback apply as they do for products.

### Category (`product-category`)
- `parent` (self relation, optional), `position` (order among siblings), `active`.
- Translation: `name` (required in the default locale), `slug` (unique per locale), `description`,
  `seoTitle`, `seoDescription`.
- Category image removed by the owner on 2026-11-22.
- Depth: at most **5** levels.
- Product → category: many-to-one, optional.
- Deleting a category is refused while it has subcategories; its products lose their category.
- Names need not be unique; the slug is unique per locale across the whole tree.
- Moving a category (changing parent) may not create a cycle or exceed 5 levels.
- A JSON `attributes` placeholder is **not** added; per-category attributes, if ever needed, get their
  own content type later.

### Product type (`product-type`)
- Translation: `name`. A normalized key (`trim`, collapsed spaces, lower case, of the default-locale
  name) is unique: creating "  shirt " when "Shirt" exists reuses "Shirt".
- Product → type: many-to-one, optional.
- Deleting a type clears it on its products.
- A rename whose normalized key collides with another type is refused (no automatic merge).

### Tag (`product-tag`)
- Translation: `name`. Same normalized unique key as product type.
- Product ↔ tag: many-to-many (no duplicates).
- Deleting a tag removes it from products.
- A rename that collides with another tag is refused, as for types.

### Collection (`collection`)
- `type`: `MANUAL` | `AUTOMATED`.
- `sortOrder`: `MANUAL` | `BEST_SELLING` | `TITLE_ASC` | `TITLE_DESC` | `PRICE_ASC` | `PRICE_DESC` |
  `NEWEST` | `OLDEST`. `MANUAL` is only allowed for manual collections.
- `active` (published on the storefront or not).
- Collection image removed by the owner on 2026-11-24.
- Translation: `title` (required in the default locale), `handle` (unique per locale, like the
  product slug), `description`, `seoTitle`, `seoDescription`.
- Automated: `match` (`ALL` | `ANY`) and its conditions (below).
- `createdAt` / `updatedAt` from Strapi.

### Collection product (`collection-product`)
- `collection`, `product`, `position` (used by manual order), unique (collection, product).
- Holds the members of both kinds of collection: chosen by hand for manual ones, computed for
  automated ones.

### Collection condition
Stored on the collection as JSON (like promotion conditions), validated by the server:
`{ field, operator, value }`.

| Field | Operators | Value |
|---|---|---|
| Title | equals, not equals, contains, does not contain, starts with, ends with | text (matched against the product name in any locale, case-insensitive) |
| Category | equals, not equals | category id (equals includes its subcategories) |
| Product type | equals, not equals | type id |
| Tag | equals (has tag), not equals (does not have tag) | tag id |
| Price | =, ≠, >, <, ≥, ≤ | cents |
| Compare-at price | =, ≠, >, <, ≥, ≤ | cents |
| Inventory quantity | =, ≠, >, <, ≥, ≤ | integer |

- Up to 60 conditions; at least one for an automated collection.
- **Variant rule (price, compare-at price, inventory):** a product matches when **at least one active
  variant** matches. A variant without compare-at price never matches a compare-at condition.
- Only active products with at least one active variant are members (as the storefront list).
- Inventory quantity is the variant's stored `stock` (it may be negative; every variant tracks stock).
- A category condition matches the category's whole subtree whether those categories are active or
  not (membership does not depend on category visibility).
- **Referenced entities (decided by the owner):** a category, type or tag used by an automated collection's
  condition **cannot be deleted**; the refusal lists those collections. This avoids a dangling
  "not equals" silently matching every product.

### Compare-at price
- Variant: `compareAtPrice` (integer cents, optional; when set it must be greater than `price`: a save
  that leaves it equal or below — by changing either field — is refused). Promotions never change it. Shown in the variant editor and the storefront product answers (`compareAtPrice`).

## Keeping automated collections up to date

No queue: the work is incremental and done in the same request, scoped to what changed. The store's
catalogue is small (hundreds to a few thousand products); a collection-wide re-evaluation in batches
of 200 within one request is acceptable. Bulk product actions take at most 100 product ids per call.

- **A product changes** (create, update, delete; variant price / compare-at / stock / active;
  category, type, tags, name): that one product is re-evaluated against every automated
  collection; memberships are added or removed. Stock changes from orders (stock movements) trigger
  the same check for the products involved.
- **A collection's conditions or match change**: that collection is re-evaluated over the catalogue
  in batches (page size 200), adding and removing members.
- **A category moves**: the automated collections with a category condition are re-evaluated.
- **Recalculate** button on an automated collection (admin) re-runs its evaluation, for repair.
- Evaluation is idempotent (computes the target set, applies the difference).
- No periodic cron (the module has none today); the manual Recalculate is the reconciliation.

## Sorting

- **Manual**: `collection-product.position`, set by drag and drop in the admin (manual collections).
- **Best selling**: units sold in orders created in the last **90 days** whose `orderStatus` is not
  `CANCELLED` and whose `paymentStatus` is `PAID` or `PARTIALLY_REFUNDED`, minus `returnedQuantity`;
  gift lines are not counted; ties by newest.
- **Title A–Z / Z–A**: product name in the request locale (default-locale fallback).
- **Price low → high / high → low**: lowest / highest active-variant price (as the storefront list).
- **Newest / Oldest**: product id descending / ascending (ids follow creation, as the existing `newest`).
- Category pages offer the same sorts except Manual (default: newest).

## Admin

### Products menu
New entries in the products area: **Categories**, **Collections**, and a page for **Types & tags**
(two tables, rename / delete, with product counts). Permissions: the existing
`ecommerce.products.read` to view and `ecommerce.products.manage` to change — no new permissions.

### Categories page
- Tree view (indented table) with name, slug, product count, active; Add (top right), Edit, Delete;
  reorder siblings and move to another parent.
- Edit page / modal: parent picker, translations (locale switcher), SEO, active.

### Collections
- List: search (38px, full width), title, type badge (Manual / Automated), product count, active;
  Create collection in the header; pagination.
- Edit page: header Delete / Save; sections:
  - **General**: title, handle, description (per locale, locale switcher), active.
  - **Type**: manual or automated (chosen at creation; not changeable afterwards).
  - **Products** (manual): search to add products (floating dropdown), table with drag handle,
    image, name, Remove; empty state.
  - **Conditions** (automated): "all conditions" / "any condition", condition rows (field, operator,
    value with pickers for category / type / tag), a plain-words sentence like the promotion
    conditions, and a live **preview** of the matching products (paginated table, count).
  - **Sorting**: the sort order select.
  - **SEO**: title and description per locale.

### Product page — new section "Product organization"
- **Category**: picker with search by name and tree browsing; shows the full path
  ("Clothing > Shirts > Linen"); Change / Remove.
- **Product type**: select with search; typing a new name offers "Create “…”".
- **Collections**: multi-select of **manual** collections; automated collections the product is in are
  listed read-only (badge "Automated").
- **Tags**: multi-value input with autocomplete of existing tags; new tags created on save.
- Variant editor: **Compare-at price** field next to price.

## Admin API (under the existing e-commerce admin routes, products permissions)

- Categories: list (tree), get, create, update, delete, move.
- Product types: list (search, paginated), create, rename, delete.
- Tags: list (search, paginated), create, rename, delete.
- Collections: list (search, paginated), get, create, update, delete, products (paginated),
  add / remove / reorder products (manual), preview conditions, recalculate.
- Products: the product create / update body gains `categoryId`, `typeId` (or `typeName` to create),
  `tagIds` / `tagNames`, `collectionIds` (manual only); variants gain `compareAtPrice`.
- Product list filters: category (with subcategories), type, tag, collection.
- Bulk: add / remove a tag, set category, set type, add to / remove from a manual collection, for a
  list of product ids.

## Storefront API (documented in `docs/ecommerce/storefront-api.md`)

- `GET /categories?locale=` — the active category tree (id, name, slug, parent, position).
- `GET /categories/:slug?locale=` — one category with its path (breadcrumb).
- `GET /collections?locale=&page=&pageSize=` — active collections, by title (paginated).
- `GET /collections/:handle?locale=` — title, handle, description, SEO.
- `GET /products?...&category=<slug>&collection=<handle>&type=<id>&tag=<id,id>` — the
  existing list gains these filters, combined with AND:
  - `category` / `collection`: slug / handle in the request locale, falling back to the default
    locale; unknown or inactive → 404.
  - `type`: one type id. `tag`: comma-separated tag ids, a product with **any** of them matches.
    Types and tags have no slug; product answers carry their ids and names.
  - With `collection`, the collection's sort applies unless `sort` is given.
  - Sorts added: `name_desc`, `best_selling`, `oldest`.
- Product answers gain `category` (id, name, slug, path), `type` (name), `tags` (names),
  and `compareAtPrice` on variants / price summaries.
- An inactive category hides its whole subtree from the tree and answers 404 (as do its
  descendants); inactive collections answer 404. Their products remain reachable by other routes. Automated-collection conditions and admin data are never exposed.
- Same `catalog` rate-limit rule.

## Tests (acceptance)

- One category / one type per product; many collections and tags; no duplicate links.
- Type / tag dedupe ignoring case and spaces.
- Category depth limit, cycle refusal, delete refused with subcategories, products kept.
- Manual collection: add, remove, reorder.
- Automated: ALL / ANY; each field and operator; variant rule; members added / removed when a
  product, variant price / compare-at / stock, category, type or tag changes; when conditions
  change; when a referenced category / type / tag is deleted.
- Each sort order, including best selling eligibility.
- Deleting category / type / tag / collection never deletes products.
- Permissions: read vs manage.
- Storefront: category tree, collection by handle, filtered and sorted lists, inactive → 404, no
  conditions exposed, compare-at exposed.

## Left to the builder

- Exact component split, file names and admin route paths, following the existing module.
- Index choices (the relation and filter columns must be indexed).
- Batch sizes and how the per-product re-evaluation is invoked from the existing product, variant and
  stock services.
- Admin copy (en / pt), following the existing tone.
