# Littlebox image field + crop with zoom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** custom field `ltbimage` (single image / gallery) whose picker crops with zoom and stores only the
WebP result in the Media Library; the e-commerce image modal switches to the same crop-with-zoom step.

**Architecture:** a shared admin crop step (`react-easy-crop` with zoom, no restriction, coverage check)
used by the e-commerce modal and the new field modal; a server service that processes with the existing
sharp pipeline and creates the file through Strapi's upload service in a "Littlebox" folder, recording
each created file in a small registry content type; a document-service middleware that validates values
and deletes registry files that stopped being referenced; lazy orphan cleanup.

**Tech Stack:** Strapi 5 plugin (TypeScript), React + @strapi/design-system v2, react-easy-crop, sharp,
vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-image-field-design.md`

## Global Constraints

- **NO COMMITS.** Leave every change in the working tree. Never touch `.yalc/` or `yalc.lock`.
- Only the new field and the e-commerce image upload modal change; no other module changes.
- Output always WebP quality 80 via `processImage` (`server/src/services/modules/ecommerce/domain/imageProcessing.ts`);
  max dimension 6000, max upload 15 MB.
- Notices: background `#43311a`, white text (existing NOTICE_BACKGROUND / NOTICE_TEXT constants).
- Search bars / single-line inputs in this work: 38px tall.
- Copy in en and pt (`admin/src/core/translations/{en,pt}.json`), keys prefixed by the plugin id like the rest.
- Tests in `tests/` (vitest); `npx vitest run` and `npx tsc` for admin, server, tests projects must pass.
- Never log customer data or file contents.

## Rulings (decided by the controller; the owner reviews at the end)

- Alt text: set on the file at upload; editing it in the field updates both the stored value and the
  Media Library file's `alternativeText` (field-created files only).
- Field-created files are recorded in a new content type `ltb-st-module-image-field-file`
  (`file` relation-free: `fileId` integer unique, `createdAt`), hidden from the Content Manager / CTB.
  Cleanup only ever deletes files present in this registry (a file a user uploads by hand into the
  "Littlebox" folder is never touched).
- "Choose from the Media Library" is hidden when the user lacks `plugin::upload.read`.
- Server validates: gallery value is an array of objects with numeric `id`; single is object or null;
  `maxImages` enforced; required + gallery rejects `[]`.

## Review Focus

1. Zooming out until the image leaves part of the crop area empty → Confirm disabled + orange notice;
   zooming back in re-enables it.
2. Removing an image from an entry that has a draft and a published version where the published one
   still has it → file NOT deleted until no version / locale / entry references it.
3. Picking an original from the Media Library → original file untouched (same hash / url) after upload,
   and never deleted by cleanup.
4. Locked size with an original smaller than the size → upscale warning, still allowed, result exact size.
5. Gallery reorder persists in the stored array order and in the API answer.

---

### Task 1: Shared crop-with-zoom step; e-commerce modal uses it

**Files:**
- Create: `admin/src/components/image/CropZoomStep.tsx`, `admin/src/core/utils/imageCrop.ts`
- Modify: `admin/src/ecommerce/components/ImageUploadModal.tsx` (drop Crop/Resize tabs, use the step;
  keep the existing sources incl. URL tab), `admin/src/ecommerce/utils/cropMath.ts` (may re-export)
- Test: `tests/admin/imageCrop.test.ts`

**Interfaces (Produces):**
- `imageCrop.ts`:
  - `coversArea(areaPercent: Rect, tolerance = 0.05): boolean` — true iff `x >= -tol`, `y >= -tol`,
    `x + width <= 100 + tol`, `y + height <= 100 + tol` (react-easy-crop percentages with
    `restrictPosition={false}`).
  - `isUpscale(pixelCrop: Rect, output: Size): boolean` — `pixelCrop.width < output.width || pixelCrop.height < output.height`.
  - `startSize(natural: Size, preset: { width?: number; height?: number }): Size` — both set → preset;
    one set → the other from the natural ratio (`lockedHeight`); none → current `initialSize` logic
    (fit in 6000 keeping ratio). Results clamped to 1..6000.
- `CropZoomStep` props:
  `{ src: string; natural: Size; size: Size; sizeLocked: boolean; onSizeChange(size: Size): void;
     onChange(state: { transform: ImageTransform | null; covers: boolean; upscale: boolean }): void;
     disabled?: boolean }`
  - Renders width / height inputs (read-only when `sizeLocked`; when editing the width, height is not
    recomputed — the crop aspect follows `width/height`), the Cropper (`aspect = width/height`,
    `restrictPosition={false}`, `minZoom={0.1}`, `maxZoom={10}`, `zoomWithScroll`), a zoom slider
    (design-system or `<input type="range">` styled), the orange notice when `!covers`
    (key `image.crop.mustCover`), the upscale warning (key `image.crop.upscale`).
  - `transform` = `{ mode: 'crop', width, height, crop: toPixelCrop(areaPercent, natural) }` when sizes
    valid, else null.
- E-commerce modal: Confirm disabled when `!covers` or `transform === null`; sends the same form fields
  as today (`buildUploadForm`) with `mode: 'crop'`. Remove resize-only state / copy keys no longer used.

- [ ] Write failing tests for `coversArea`, `isUpscale`, `startSize` (incl. boundary: exactly 0/100,
      tolerance, one-dimension preset, >6000 clamp).
- [ ] Implement `imageCrop.ts`; tests pass.
- [ ] Implement `CropZoomStep`; wire it into `ImageUploadModal`; translations en/pt; remove unused keys.
- [ ] `npx tsc -p admin/tsconfig.json --noEmit`, `npx vitest run tests/admin` pass. No commit.

### Task 1b: Custom crop editor (replaces react-easy-crop inside CropZoomStep) — owner revision

Spec goal 4 (revised). Task 1's helpers and wiring stay; the editor inside `CropZoomStep` becomes our
own component because react-easy-crop cannot stretch one axis nor show resize handles.

**Files:**
- Create: `admin/src/components/image/CropEditor.tsx` (viewport, fixed frame, image box, handles,
  guides), `admin/src/core/utils/cropEditor.ts` (pure geometry)
- Modify: `admin/src/components/image/CropZoomStep.tsx` (keep-proportion toggle, Fit width / Fit height /
  Fill frame buttons, zoom slider, warnings), `admin/src/core/utils/imageCrop.ts` if helpers move,
  translations en/pt; remove the `react-easy-crop` import from the step (keep the dependency only if
  something else still uses it — if nothing does, leave package.json untouched and say so)
- Test: `tests/admin/cropEditor.test.ts`

**Geometry (`cropEditor.ts`), all in viewport pixels:**
- `type Box = { x: number; y: number; width: number; height: number }` — `frame` (fixed, centered, as
  large as fits the viewport with padding, aspect = output width/height) and `image` (the image's
  displayed box; `scaleX = image.width / natural.width`, `scaleY = image.height / natural.height`).
- `covers(frame, image, tol = 0.5): boolean` — image box contains the frame.
- `isDeformed(image, natural, tol = 0.005): boolean` — `|scaleX/scaleY - 1| > tol`.
- `toSourceCrop(frame, image, natural): Rect` — the frame expressed in original pixels, rounded and
  clamped to the natural bounds (only meaningful when `covers`).
- `fitWidth(frame, image, natural)`, `fitHeight(...)`, `fillFrame(...)` → new centered image box
  (fit* keep the image's current proportion `image.width/image.height`; fill = frame box).
- `zoomAt(image, factor, origin)` — uniform scale around a point (wheel / pinch at the cursor, slider at
  the frame center); clamp so the image's larger side stays within [frame min side × 0.1, natural × 10].
- `resizeWithHandle(image, handle, dx, dy, keepRatio)` — handles `n s e w ne nw se sw`; corners keep the
  current ratio, edges change one axis; the opposite side / corner stays fixed; min size 8px.
- `snapToCenter(frame, image, threshold = 6): { image, centeredX, centeredY }` — snaps the image center to
  the frame center per axis when within threshold; flags drive the red guides (1px, `#ee5e52` or the
  design-system danger600).
- When the output size / frame changes, keep the image's relation to the frame (scale the image box by
  the frame's change) so the user's framing is preserved.

**Editor UI:** pointer events (mouse + touch) for drag and handles; 8 handles (small white squares with a
neutral border) on the image box; area outside the frame darkened; the frame outlined; guides drawn
across the frame; wheel zoom (preventDefault) and ctrl+wheel pinch. Keyboard: arrows move 1px
(shift 10px) when the editor is focused.

**Step UI:** keep-proportion chain toggle between width and height (hidden when `sizeLocked`); buttons
"Fit width", "Fit height", "Fill frame"; zoom slider; notices: must-cover (orange, blocks Confirm),
deformed (warning), upscale (warning). `onChange` gains `deformed: boolean`.

- [ ] Tests first for the geometry functions (covers edge, deformation tolerance, fit/fill results,
      handle math for a corner and an edge with the opposite side fixed, snapping on/off threshold,
      toSourceCrop rounding/clamping).
- [ ] Implement; e-commerce modal and (later) field modal use the same step; tsc + admin tests pass.

### Task 2: Server — field registration, registry, upload and alt routes

**Files:**
- Modify: `server/src/register.ts` (register `ltbimage`, type `json`), `server/src/config/index.ts`
  (`uuid.customFields.image`, `uuid.modules.imageField.file`), content-types index, services / controllers
  / routes indexes, `server/src/routes/admin-api.ts`
- Create: `server/src/content-types/<registry>/schema.json` (`ltb-st-module-image-field-file`,
  `pluginOptions` hiding it from CM and CTB like the other plugin internals),
  `server/src/services/modules/image-field.ts`, `server/src/services/modules/image-field/domain/mediaValue.ts`,
  controller + routes for the field.
- Test: `tests/server/imageField/*.test.ts`

**Interfaces (Produces):**
- `toMediaValue(file): MediaValue` — picks exactly the spec's keys
  (`id, documentId, name, alternativeText, caption, width, height, formats, hash, ext, mime, size, url,
  previewUrl, provider, provider_metadata, createdAt, updatedAt`).
- Service `image-field` methods:
  - `upload({ buffer?: Buffer; sourceFileId?: number; originalName?: string; transform: ImageTransform;
     alternativeText?: string | null }): Promise<MediaValue>` — exactly one source. Library source:
     load `plugin::upload.file` by id (must be an image), read bytes (local provider: `public/` + url
     path via `strapi.dirs.static.public`; otherwise `fetch(url)`), never modify it. Process with
     `processImage` (crop only; reject `resize`), write to a temp file, create through
     `strapi.plugin('upload').service('upload').upload({ data: { fileInfo: { name, alternativeText, folder } }, files })`
     with name = original base name + `.webp`, folder = id of folder "Littlebox" (create at root if
     missing via the upload `folder` service), record `{ fileId }` in the registry, then call
     `collectOrphans()` (throttled, Task 3 provides it; until then a no-op hook).
  - `updateAlt(fileId: number, alternativeText: string | null): Promise<MediaValue>` — only registry files
    (else 404).
- Admin routes (type admin, `admin::isAuthenticatedAdmin` + `admin::hasPermissions` with
  `plugin::upload.assets.create`; library source additionally requires `plugin::upload.read`):
  - `POST /image-field/upload` multipart: `file` (optional), `sourceFileId` (optional), `transform`
    (JSON string), `alternativeText` → `{ data: MediaValue }`. Mirror how the e-commerce product image
    upload reads multipart and maps `INVALID_IMAGE` / size errors to 400.
  - `PUT /image-field/files/:id/alt` body `{ alternativeText }` → `{ data: MediaValue }`.
- [ ] Tests first for `toMediaValue`, source validation (both / neither source → 400, resize → 400),
      library original not modified (mocked upload service receives a new file; no update on source).
- [ ] Implement; `npx tsc -p server/tsconfig.json --noEmit` and server tests pass. No commit.

### Task 3: Server — value validation, cleanup of unreferenced files, orphan GC

**Files:**
- Create: `server/src/services/modules/image-field/cleanup.ts`, `.../domain/values.ts`,
  document middleware registration (in `register.ts` or `bootstrap.ts`: `strapi.documents.use`)
- Test: `tests/server/imageField/*.test.ts`

**Interfaces (Produces):**
- `fieldPaths(strapi)`: every `{ uid, attribute, options }` whose attribute is
  `customField: 'plugin::littlebox-strapi-suite.ltbimage'`, across content types **and components**,
  plus how each content type reaches them (direct, component, repeatable component, dynamic zone).
- `collectIds(value): number[]` (object, array or null).
- `validateValue(value, options): void` — throws `errors.ValidationError` (from `@strapi/utils`) per the
  rulings (shape, `maxImages`, required gallery not empty).
- `isReferenced(fileId): Promise<boolean>` — scans every field path (all rows of all content types and
  component tables, all locales, draft + published) for the id. Batches of 500 rows.
- Document middleware: for `create`, `update`, `publish`, `delete`, `discardDraft`, `unpublish` on a
  content type that reaches an `ltbimage` field: validate incoming data (create/update); before the action
  collect ids of all versions of the document (deep-populate the component paths), after it collect them
  again; for each id in before − after that is in the registry and `!isReferenced(id)`: delete the file
  through the upload service (removes formats) and its registry row. Errors in cleanup are logged
  (`strapi.log.warn`, ids only) and never fail the user's save.
- `collectOrphans()`: registry rows older than 24 h whose file is not referenced → delete; rows whose file
  no longer exists → delete row. Runs on bootstrap (non-blocking) and from `upload`, at most once per hour.
- [ ] Tests first: `collectIds`, `validateValue` cases, cleanup decision (removed id still referenced by
      published version → kept; unreferenced registry id → deleted; non-registry id → never deleted),
      orphan age rule (23 h kept, 25 h deleted), throttle.
- [ ] Implement; tsc + tests pass. No commit.

### Task 4: Admin — field registration and input (single / gallery)

**Files:**
- Modify: `admin/src/index.ts` (register `ltbimage`, type `json`, icon PluginIcon-like or a new
  `ImageFieldIcon`), translations en/pt
- Create: `admin/src/components/imageField/ImageFieldInput.tsx`, `ImageFieldModal.tsx`,
  `ImageFieldDetailModal.tsx`, gateway/usecase files following the admin's existing Registry pattern or a
  plain `useFetchClient` call (match what the slug input does).
- Test: `tests/admin/imageField*.test.ts` for pure helpers (value add / remove / reorder / replace,
  max reached).

**Interfaces:**
- Consumes: `CropZoomStep`, `startSize` (Task 1); `POST /image-field/upload`, `PUT /image-field/files/:id/alt` (Task 2).
- Field options (CTB): base — `options.mode` select `single` | `gallery` (default single),
  `options.width`, `options.height` (number), `options.lockSize` (checkbox); advanced — `required`,
  `options.maxImages` (number, gallery only — describe it as ignored in single mode).
- Input (Strapi 5 custom field Input props: `name, value, onChange({ target: { name, value, type: 'json' } }),
  attribute.options, required, disabled, error, hint, label`):
  - single: empty box "Add image" → modal; filled: preview + Replace / Edit alt / Remove.
  - gallery: thumbnail grid with drag-and-drop reorder (reuse `admin/src/ecommerce/utils/gallery.ts`
    `moveImage` if suitable), "Add image" hidden when `maxImages` reached, click → detail modal
    (preview, size, alt text saved via the alt route, Remove).
- Modal: sources = `ImageDropzone` (drop / choose file, 15 MB / type checks as e-commerce) and button
  "Choose from the Media Library" opening Strapi's dialog:
  `const components = useStrapiApp('ImageFieldModal', (s) => s.components); const MediaLibraryDialog = components['media-library'];`
  with `allowedTypes={['images']}` and single selection; hidden without `plugin::upload.read`
  (`useRBAC`). Then `CropZoomStep` with `startSize(natural, {width, height})` and
  `sizeLocked = lockSize && width && height`; alt text input; Confirm uploads and returns the
  `MediaValue`.
- [ ] Tests for the helpers first; implement; translations; tsc + tests pass. No commit.

### Final

- [ ] Whole-change review (most capable model) against the spec and Review Focus.
- [ ] Controller: publish to the test Strapi, add the field to a test content type only if the owner's
      project already has one meant for testing — otherwise verify the CTB shows the field and the modal
      in the browser without saving content; report.
