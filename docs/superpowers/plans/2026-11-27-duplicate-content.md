# Duplicate Content Implementation Plan

> **For agentic workers:** implement task by task. Steps use checkbox (`- [ ]`) syntax. **Do not commit**: the
> owner asked for a single commit of the whole feature at the end (the controller makes it).

**Goal:** a dashboard card "Duplicate content" whose modal copies every localized `api::*` document (and,
optionally, the e-commerce translations and customized e-mail templates) from the default locale into a chosen
locale, translated with AI, with relations pointing at the target-locale copies.

**Architecture:** pure domain modules (scope, dependency plan, data mapping, translatable strings) under
`server/src/services/modules/duplicate/domain/`, a background runner service that writes through the Strapi 5
Document Service (so the slug / page-attribute lifecycles and the image-field middleware run as for a manual
save), a run log content type, admin routes gated by a new permission, and an admin card + modal that polls
the run.

**Tech Stack:** Strapi 5.61 (Document Service, i18n), TypeScript, vitest, React + @strapi/design-system v2.

**Spec:** `docs/superpowers/specs/2026-11-27-duplicate-content-design.md` (read it first; it is the authority).

**Facts sheet (paths, signatures, behaviours already verified):**
`/private/tmp/claude-501/-Users-filipemoraes-Projects-littlebox-plugins-strapi-suite/ceba2c25-6fa0-44d3-9e8a-9205d7c11e1b/scratchpad/duplicate-facts.md`

## Global Constraints

- Plugin id `littlebox-strapi-suite`; admin HTTP prefix `/${pluginId}/admin/...`.
- New routes live under `/admin/duplicate/...`; never use the `check-module-is-active` middleware on them.
- Permission action uid `duplicate.run` (full `plugin::littlebox-strapi-suite.duplicate.run`), displayName
  "Duplicate content", section `plugins`, subCategory `duplicate`; registered by its own function (do not touch
  `ECOMMERCE_ACTIONS`).
- Runs kept: the newest **20**. One run at a time (start refused with 409 `{ code: 'RUN_IN_PROGRESS' }`).
- Source locale = i18n default locale; target ≠ default and must be a configured locale.
- Options: `existing: 'skip' | 'replace'`, `status: 'follow' | 'draft'`, `ecommerce: boolean`.
- AI: `AiTranslationModuleService.getCredentials()` + `translateStrings(credentials, source, target, strings)`
  called directly (never the HTTP-context methods). No credentials ⇒ copy untranslated. Failed strings keep
  the source text and the document counts as `untranslated`.
- Never stop the run for one document: record `{ uid, documentId, title?, reason }` and continue.
- Do not change behaviour of: admin Translate with AI (`documentFields.ts`, `translateDocument.ts`), the
  e-commerce translate endpoints, the slug lifecycles. Server copies of admin rules are allowed (spec).
- Copy en + pt for every new admin string; notices #43311a / white text; design-system v2; search bars 38px.
- Never log customer data or secrets; log errors by name/code.
- No commits.

## Review Focus

1. A relation to a localized type whose target-locale version does not exist yet must never reach the Document
   Service (it throws): the plan order and the deferred-relation fix-up must guarantee it, cycles included.
2. "Replace" on a document published in the target with option "draft" must leave the target's published
   version untouched.
3. Slug / page attributes: a duplicated page gets its translated slug row and its parent mapped to the parent's
   target-locale documentId, for draft and (when followed) published state.
4. A server restart mid-run leaves no run stuck in RUNNING (boot marks it INTERRUPTED).
5. Content types without the i18n plugin option, non-`api::` types and single types without a default-locale
   entry are ignored without errors.

---

### Task 1: Domain — scope, relations and the dependency plan

**Files:**
- Create: `server/src/services/modules/duplicate/domain/scope.ts`, `.../domain/plan.ts`
- Test: `tests/server/duplicate/scope.test.ts`, `tests/server/duplicate/plan.test.ts`

**Interfaces (produces):**
```ts
// scope.ts
export type SchemaLookup = { contentType(uid: string): any | undefined; component(uid: string): any | undefined };
export function isLocalizedApiType(uid: string, ct: any): boolean; // uid starts with 'api::' and ct.pluginOptions?.i18n?.localized === true
export function listScope(contentTypes: Record<string, any>): { uid: string; kind: 'collectionType' | 'singleType'; draftAndPublish: boolean }[]; // sorted by uid
export type RelationRef = { path: string; targetUid: string; documentId: string };
/** Localized-target relations of a document (attributes, nested components, dynamic zones), paths like `author`, `blocks.0.cta.page`. Relations to not localized targets are not returned. */
export function collectLocalizedRelations(uid: string, doc: any, lookup: SchemaLookup): RelationRef[];
export function deepPopulate(uid: string, lookup: SchemaLookup): Record<string, any>; // components nested, dynamiczone {on:{...}}, relations {fields:['documentId','locale']}, media true; skips createdBy/updatedBy/localizations
```
```ts
// plan.ts
export type NodeKey = string; // `${uid}#${documentId}`
export type PlanStep =
  | { kind: 'create'; key: NodeKey; deferred: string[] } // relation paths to leave empty for now
  | { kind: 'fix'; key: NodeKey; paths: string[] };       // set the deferred relations
/** Order: dependencies first; cycles broken by deferring the closing edges of one member (prefer the member with the fewest required deferred paths; `required(key, path)` tells if a path is required); a self-relation is a cycle of one. Edges to keys not in `nodes` are ignored (the runner reports them). Deterministic (stable by key). */
export function buildPlan(nodes: NodeKey[], edges: { from: NodeKey; to: NodeKey; path: string }[], required?: (key: NodeKey, path: string) => boolean): PlanStep[];
```

- [ ] Tests: `listScope` keeps only `api::` + localized, sorts; `collectLocalizedRelations` finds relations at top level, in single/repeatable components and dynamic zones (correct paths), skips not localized targets and empty values, supports oneToOne/manyToOne (`{documentId}`) and toMany (arrays); `deepPopulate` shape. `buildPlan`: chain A→B→C gives C,B,A creates and no fix; cycle A↔B gives one create with deferred path, the other plain, then one `fix`; self-relation gives create(deferred)+fix; two-node cycle where one side's path is required defers the other side; edges to unknown keys ignored; deterministic output.
- [ ] Implement until green (`npx vitest run tests/server/duplicate`).

### Task 2: Domain — translatable strings, slug, e-mail templates

**Files:**
- Create: `server/src/services/modules/duplicate/domain/strings.ts`, `.../domain/emailTemplateText.ts`
- Test: `tests/server/duplicate/strings.test.ts`, `tests/server/duplicate/emailTemplateText.test.ts`

**Interfaces (produces):**
```ts
// strings.ts — server port of admin/src/core/utils/documentFields.ts working on the SOURCE alone
export type StringField = { path: string; value: string; kind: 'text' | 'slug' };
export function collectStrings(uid: string, data: any, lookup: SchemaLookup): StringField[]; // same rules as documentFields.ts (localized only; string/text/richtext not matching URL_PATTERN; blocks text nodes recursively; slug custom field + uid as kind 'slug'; components/DZ)
export function toAiStrings(fields: StringField[]): Record<string, string>; // keys '0','1',...; slug sent with '-' → ' '
export function applyStrings(data: any, fields: StringField[], translations: Record<string, string>): { data: any; failed: number }; // writes at paths (immutably); slug → convertToSlug; missing/blank keeps source and counts failed
export function convertToSlug(text: string, maxLength?: number): string; // copy of admin/src/core/utils/convertToSlug.ts default behaviour
```
```ts
// emailTemplateText.ts — server copy of admin/src/ecommerce/utils/emailTextEditing.ts (splitTemplate, joinTemplate, translationStrings, applyTranslation, encodeText) + decodeEntities(html): string (named + numeric entities, no DOM)
```
- [ ] Tests mirror the admin behaviour: URLs skipped, blocks paths `field.0.children.1.text`, components/DZ paths, not localized skipped, slug round trip (`'about-us'` sent as `'about us'`, result slugified), failed counting; e-mail: same expectations as `tests/admin/ecommerce/emailTextEditing.test.ts` for split/apply, plus `decodeEntities('&amp;&lt;&#123;&nbsp;')`.
- [ ] Implement until green.

### Task 3: Domain — target data mapping

**Files:** Create `server/src/services/modules/duplicate/domain/mapData.ts`; Test `tests/server/duplicate/mapData.test.ts`

**Interfaces (produces):**
```ts
/** Builds the Document Service `data` for the target locale from a populated source version:
 * only localized attributes; drops id/documentId/locale/createdAt/updatedAt/publishedAt/createdBy/updatedBy/localizations;
 * components and DZ entries without `id` (DZ keep `__component`); media → ids (single id or array);
 * relations to not localized targets → `{ connect: [{ documentId }] }`-style `set` of documentIds;
 * relations to localized targets → documentIds (same documentIds: Strapi links the same locale), except paths in `deferred` → empty;
 * `emptyAsNull`: when true (Replace) attributes absent/empty in the source are written as null / [] so the target is a true copy.
 * Slug custom field value is not written (the slug goes through ltb_slug). ltbimage (json) copied as is. */
export function mapData(uid: string, source: any, lookup: SchemaLookup, opts: { deferred?: string[]; replace?: boolean }): any;
export function slugFieldOf(uid: string, lookup: SchemaLookup): string | null; // attribute name with customField 'plugin::littlebox-strapi-suite.ltbslug'
```
- [ ] Tests for every rule above (including a relation inside a repeatable component being deferred, and Replace writing null for an empty localized string and [] for an empty toMany relation).
- [ ] Implement until green.

### Task 4: Run log, permission and boot sweep

**Files:**
- Create: `server/src/content-types/modules/duplicate/run/{schema.json,index.ts}` (collectionName `ltb_st_module_duplicate_runs`, singularName `ltb-st-module-duplicate-run`; attributes: `status` enum RUNNING|SUCCESS|FAILED|INTERRUPTED default RUNNING, `sourceLocale`, `targetLocale` strings, `options` json, `startedAt` datetime required, `finishedAt` datetime, `userId` string, `userName` string, `progress` json `{ total, done, current }`, `counts` json `{ duplicated, replaced, skipped, untranslated, failed }`, `failures` json array (max 500 kept); flags like cron-run; index on `started_at`)
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (`uuid.modules.duplicateRun`)
- Create: `server/src/services/modules/duplicate/runs.ts` (`DuplicateRunService`), `server/src/services/modules/duplicate/permissions.ts` (`DUPLICATE_PERMISSION`, `registerDuplicatePermissions(strapi)`)
- Modify: `server/src/services/index.ts`, `server/src/bootstrap.ts` (register permission; `interruptAll()` on boot)
- Test: `tests/server/duplicate/runs.test.ts`, `tests/server/duplicate/permissions.test.ts`; update any schema guard tests that enumerate content types.

**Interfaces (produces):**
```ts
DuplicateRunService: {
  start(input: { sourceLocale; targetLocale; options; userId; userName; total }): Promise<number>; // prunes to 20
  progress(id, patch: { done?; current?; counts?; failure? }): Promise<void>; // appends failure (cap 500)
  finish(id, status: 'SUCCESS' | 'FAILED'): Promise<void>; // only when RUNNING
  interruptAll(): Promise<number>;
  running(): Promise<RunView | null>;
  list(): Promise<RunView[]>; // newest first, max 20
}
```
- [ ] Tests (fakeDb, fake timers) then implement.

### Task 5: The runner

**Files:** Create `server/src/services/modules/duplicate/runner.ts` (`DuplicateService`); Modify `server/src/services/index.ts`; Test `tests/server/duplicate/runner.test.ts` (hand-mocked `strapi.documents(uid)`, fakeDb for slug/attribute/e-commerce tables, mocked AI service).

**Interfaces (consumes Tasks 1–4; produces):**
```ts
DuplicateService: {
  summary(targetLocale: string, ecommerce: boolean): Promise<{ sourceLocale; targetLocale; aiAvailable: boolean; contentTypes: { uid; displayName; count }[]; ecommerce?: { products; variants; categories; collections; tags; emailTemplates } }>;
  start(input: { targetLocale; existing; status; ecommerce }, user: { id; name }): Promise<{ runId: number }>; // validates, refuses when running, then runs in background (not awaited)
}
```
Behaviour (spec "Duplicating one content", "Ordering", "AI translation"):
- Load every default-locale document of the scope (draft versions; plus published versions for D&P types) with `deepPopulate`; build nodes/edges from `collectLocalizedRelations` of both versions; `buildPlan`.
- For each step: existing target (draft or published in target locale) + `skip` ⇒ count skipped. Otherwise translate (one `translateStrings` call per document version, batching handled by the engine), map data, read the source slug row / attribute row (`state` draft/published) and send `ltb_slug` (translated), `ltb_attribute_parent` = parent documentId (the parent is a dependency edge `__parent`), `ltb_attribute_parent_model`, `ltb_attribute_template`, `ltb_attribute_priority`, `ltb_attribute_frequency`.
- Writes: `strapi.documents(uid).update({ documentId, locale: target, data })` (creates the locale); status `follow`: source published-only/identical ⇒ write then `publish({ documentId, locale })`; source published with newer draft ⇒ write published content, publish, then update the draft with the draft content; `draft` ⇒ draft only (Replace never touches the target's published version).
- `fix` steps: `update` with only the deferred paths (and publish again if the target is published under `follow`).
- E-commerce (option on and module active): for each product / variant / category / collection / tag with a default-locale translation row, create or (Replace) update the target row with translated fields; slugs via the e-commerce `slugify` + `resolveUniqueSlug` against slugs of other entities in the target locale (categories/collections/products); e-mail templates customized in the default locale: translate subject + text parts (Task 2), save through `EcommerceEmailTemplateService.save(type, target, {subject, html}, userId)` unless skip and a custom target exists.
- Progress after each document; failures recorded; finish SUCCESS (FAILED only when the run itself crashed).
- [ ] Tests: chain ordering writes dependencies first; cycle produces create-without-relation then fix; skip vs replace; draft vs follow (including published+newer draft and Replace+draft leaving published untouched); slug/attribute virtual fields with mapped parent; AI unavailable ⇒ untranslated copy; AI partial failure ⇒ counted untranslated; one failing document recorded and the run continues; e-commerce rows and slug uniqueness; refusal when a run is RUNNING.
- [ ] Implement until green.

### Task 6: Controller and routes

**Files:** Create `server/src/controllers/modules/duplicate.ts` (`DuplicateController`), `server/src/routes/duplicate/admin-duplicate.ts`; Modify `server/src/controllers/index.ts`, `server/src/routes/admin-api.ts`; Test `tests/server/duplicate/routes.test.ts`, `tests/server/duplicate/controller.test.ts`.

Routes (policies `admin::isAuthenticatedAdmin` + `admin::hasPermissions` [`plugin::littlebox-strapi-suite.duplicate.run`]):
- `GET /admin/duplicate/locales` → `{ defaultLocale, locales: {code,name}[] }`
- `POST /admin/duplicate/summary` body `{ targetLocale, ecommerce }`
- `POST /admin/duplicate/runs` body `{ targetLocale, existing, status, ecommerce }` → 202 `{ runId }`; 409 `{ code: 'RUN_IN_PROGRESS' }`; 400 on invalid input (codes `invalid_locale`, `invalid_option`)
- `GET /admin/duplicate/runs` → newest 20; `GET /admin/duplicate/runs/current` → running run or null
- [ ] Tests then implement.

### Task 7: Admin card and modal

**Files:**
- Create: `admin/src/duplicate/gateway.ts` (`DuplicateGatewayHttp`), `admin/src/duplicate/usecases/*.ts`, `admin/src/duplicate/DuplicateCard.tsx`, `admin/src/duplicate/DuplicateModal.tsx`, `admin/src/duplicate/utils.ts` (pure helpers: progress %, option validation, report counts)
- Modify: `admin/src/index.ts` (provide gateway), `admin/src/pages/HomePage.tsx` (card, shown with `useRBAC` permission), `admin/src/components/Card.tsx` (optional `showStatus`, default true), `admin/src/core/translations/en.json` + `pt.json`
- Test: `tests/admin/duplicate/utils.test.ts`

UI: card title "Duplicate content", description, blue **Duplicate** button. Modal: source (read-only default) and target select; radio "Existing content in the target language": Skip | Replace; radio "Status": Follow the original | Keep everything as a draft; checkbox "Include e-commerce translations" (only when the e-commerce module is active); summary table (per content type counts, e-commerce counts, AI note; orange notice when AI is not configured: "Contents will be copied without translation"); Confirm starts the run; then progress (bar, done/total, current document) polled every 2 s; final report (counts + failures list). Reopening the modal while a run is RUNNING shows its progress; the card shows the last run's result line.
- [ ] Tests for the pure helpers; `npm run test:ts:front` clean.

### Task 8: Verify

- [ ] `npx vitest run` all green, `npm run test:ts:back`, `npm run test:ts:front`, `npm run test:ts:tests` clean.
- [ ] Live check on backend-base (localhost:1337): run a duplication into a test locale and confirm documents, relations, slugs and the report.
