# Duplicate content to another language — design

Status: approved by the owner on 2026-11-27 ("implement everything"); open questions ruled by the builder below. Branch `feat/ecommerce`.

## Intent

A store or site owner who adds a new language to Strapi has to recreate every page, every entry and every
product in that language by hand, and reconnect every relation. This feature does it in one action: copy all
the content of the default language into a chosen language, translated with AI, with the relations pointing
at the copies in the new language.

## Owner's decisions

1. **Where:** a new card ("rectangle") on the Littlebox Strapi Suite dashboard (`admin/src/pages/HomePage.tsx`),
   like the module cards, with a **"Duplicate"** button that opens the modal. Not in the Content Manager.
2. **Existing content in the target language:** the modal asks whether to **skip** it or **replace** it.
3. **Status in the target language:** the modal asks whether to **follow the original status** or keep
   **everything as a draft**.
4. **E-commerce:** the modal offers to duplicate the e-commerce translations too (the owner's choice per run).
5. **Permission:** a dedicated admin permission, assignable to any role.
6. **AI failure:** the content is duplicated anyway, untranslated (with the source text).

Agreed earlier in the conversation:

- Source language: always the **default** Strapi locale. The modal picks the **target** locale (any configured
  locale other than the default).
- Every content is duplicated **one by one**, collection types and single types alike.
- **Relations:** before duplicating a content, duplicate what it relates to (recursively, down to contents
  that depend on nothing), so the copy links to the related content **in the target language**. With a
  **circular dependency**, create one side without the relation, duplicate the other, then come back and
  set the missing relation.
- **AI translation** reuses the existing "Translate with AI" engine and settings (OpenAI key and model of the
  AI translation module). If reuse would break the current button, a separate implementation with the same
  settings is acceptable.

## Goals

1. Dashboard card "Duplicate content" (title, short description, a **Duplicate** button), shown to users with
   the permission. Unlike the module cards it has no on/off state.
2. Modal:
   - Source language (read-only: the default locale) and target language (select).
   - Existing content in the target language: **Skip** | **Replace**.
   - Status: **Follow the original** | **Keep everything as a draft**.
   - **Include e-commerce translations** (checkbox; shown only while the e-commerce module is on).
   - Before confirming, a summary of what will run: number of contents per content type, number of e-commerce
     items, and a note that every text goes through the AI (cost).
   - Without AI configured (module off or no key): the duplication still runs, untranslated, and the modal
     says so before confirming.
3. The run happens **on the server, in the background** (it can take minutes). The modal shows progress
   (done / total, the content being processed, failures) and can be closed and reopened: the card shows the
   running or last run, with its result.
4. Only **one run at a time** (a second start is refused while one runs).
5. After the run: a report with counts (duplicated, replaced, skipped, untranslated, failed) and the list of
   failures (content type, document, reason). Kept for the last runs (my call: the last 20).

## Scope of contents

- The run counts and processes **default-locale documents** (one per document, whatever its status; drafts
  that were never published are included). A single type without a default-locale entry is skipped silently.

- Content types `api::*` whose i18n is on (`pluginOptions.i18n.localized: true`), collection and single types.
  Not localized content types have no language and are left alone.
- Not included: Strapi's own types (users, admin, upload) and the plugin's own types.
- E-commerce (when chosen): the translation rows of **products, variants, categories, collections and tags**
  (`*-translation` content types: name / option / title, slug, descriptions, SEO fields). These are flat
  rows with no relation ordering problem. For every entity with a default-locale row, the target row
  (identified by entity + locale) is created from it, translated; Skip / Replace apply to an existing target
  row (my call). Slugs follow the e-commerce slug rules already used by the product translate action.

## Duplicating one content

- Copy the **localized** attributes of the source locale version. Attributes not localized are shared by
  Strapi across locales and are not written.
- **Components** (single and repeatable) and **dynamic zones**: copied recursively, without their ids.
- **Media** and **relations to not localized content types**: copied as they are (same files, same targets).
- **Relations to localized content types** (also inside components and dynamic zones): point at the target-
  locale version of the related document, which is duplicated first (see ordering). A related document that
  cannot be duplicated (failed) leaves that relation empty; the failure names it.
- **Littlebox Image field** (`ltbimage`, JSON): copied as is (the file cleanup already counts every locale,
  so no file is deleted).
- **Littlebox Slug field and page attributes**: they are not columns of the content. The plugin keeps them in
  its own slug and attribute tables (by `contentId`, `contentModel`, `locale`, `state`), written by the slug
  lifecycles from virtual request fields (`ltb_slug`, `ltb_attribute_parent`, …). The duplication sends those
  virtual fields through the Document Service, exactly like a save from the Content Manager, so the existing
  lifecycles write the side rows (my call: no direct writes to those tables):
  - `ltb_slug`: the translated slug (translated as words, then converted, as Translate with AI does). The slug
    module's uniqueness rule applies as is (a collision gets the `-<timestamp>` suffix).
  - Parent page: the parent's **target-locale** document (a dependency like a relation). Template, priority and
    change frequency: copied.
- **Draft & Publish**:
  - "Keep everything as a draft": the target is created as a draft only, from the source draft.
  - "Follow the original" (my call, mirroring Strapi's states): draft only → draft; published → published;
    published with newer draft changes → the target's published version gets the translated published
    content and its draft gets the translated draft content.
- **Skip / Replace** an existing target-locale version:
  - Skip leaves it untouched, status included (it still counts as the related content for others).
  - Replace makes it a translated copy of the source (same document): every localized attribute and relation
    takes the source's value, **including empty ones** (ruling 3).
    With "Follow the original" its status follows the source too; with "Keep everything as a draft" only its
    draft is replaced and its published version (if any) stays until someone publishes.
  - Documents that exist only in the target locale (no default-locale version) are never touched.

## Ordering and circular dependencies

- Build the dependency graph of the run: a content depends on every localized document it relates to
  (attributes, components, dynamic zones, parent page).
- Duplicate in dependency order: a content after everything it depends on.
- In a cycle: duplicate one member without the relations that close the cycle, then the others, then update
  the first one with the missing relations. A relation from a document to itself is a cycle of one (create,
  then set the relation). Relations between documents of the same content type (parent page, related posts)
  are ordinary dependencies.
- If a cycle member cannot be created without the closing relation (a required relation or required component
  field), try another member of the cycle first; if none can be created, those documents fail and are
  reported (my call), and the run continues.
- Documents that a content relates to but that are outside the run's scope are not duplicated; the relation
  is left empty and reported.

## AI translation

- Engine: `AiTranslationModuleService.translateStrings(credentials, source, target, strings)` and
  `getCredentials()` (`server/src/services/modules/ai-translation.ts`), unchanged.
- Which fields are translated: the same rules as Translate with AI (`admin/src/core/utils/documentFields.ts`):
  text, rich text and blocks, slug / uid as words, skipping URLs and empty values. The duplication runs on the
  server, so those rules must exist on the server. Preferred: move them to a module shared by the admin
  button and the server, keeping the admin's behaviour identical (its tests keep passing). If that is risky,
  a server copy with the same rules.
- E-commerce translations use the same engine (as the product "Translate" does today).
- A content whose translation fails, entirely or in part, is duplicated with the source text for the failed
  strings and counted as "untranslated" in the report.

## Permission

- A new admin action (my call: `plugin::littlebox-strapi-suite.duplicate.run`, label "Duplicate content"),
  registered with the other plugin actions and assignable in Settings → Roles.
- The admin routes of the feature (summary, start, progress, history) require it. The card is hidden
  without it.
- The run writes contents on behalf of the user who started it (recorded in the run and in the report). The
  dedicated permission is the gate: the run does not check the user's per-content-type Content Manager
  permissions (my call).

## Constraints

- Strapi 5 Document Service for every content write, so lifecycles, the slug module and the image field's
  hooks run as for a manual edit.
- Never stop the whole run because of one content: record the failure and continue.
- Runs are stored in a new plugin content type (my call, modelled on the e-commerce `cron-run`), with the
  progress written after each document, so the modal survives a page reload and a server restart marks the
  run as interrupted on the next start; running again with "Skip" continues where it stopped.
- Do not change the behaviour of the existing Translate with AI button or of the e-commerce translate actions.
- en and pt copy; notices in #43311a with white text; design-system v2.

## Non-goals

- Choosing the source language (always the default locale).
- Duplicating a selection of contents or content types (all in scope, every time).
- Menus, parameters and the plugin's Translations module (not Content Manager content). See open questions.
- Undoing a run.

## Left to the builder

- Component split, file, route and content-type names; how progress reaches the modal (polling is enough).
- How the dependency graph is built and the cycle broken (any member of a cycle may go first).
- Batch sizes for AI calls (reuse the engine's batching).

## Rulings on the open questions

The owner asked to implement right away; these were decided by the builder and can be revisited:

1. **E-commerce e-mail templates:** included with the e-commerce option. A template customized in the default
   language gets a translated customized version in the target language (Skip / Replace apply), using the same
   engine as the template editor's "Translate with AI".
2. **Menus, parameters and the plugin's Translations module:** out of scope (non-goal).
3. **Replace:** a true copy: a field empty in the source is emptied in the target.

## Known limitations

- **Single instance only (M2):** a second instance or a rolling deploy marks a live run INTERRUPTED at boot and then allows a concurrent run.
- **Cycle-deferred parent (M5):** a page whose parent is deferred by a cycle break skips the slug uniqueness check under its real parent, so two siblings can share a slug.
- **Follow + Replace unpublish (M6):** unpublishing a target page whose source was never published clears the parent of its target-only child pages.
- **Required relation in a cycle (M8):** under Follow, a cycle breaker whose deferred relation is required fails at publish and leaves a target draft without that relation.
