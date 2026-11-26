# Littlebox image field + crop with zoom

Status: approved in chat by the owner (2026-11-26; crop step revised the same day); to be built right away, **without commits** (the owner
reviews the code at the end).

## Intent

A new custom field of the Littlebox Strapi Suite plugin, usable in any content type or component: an
image field that behaves like Strapi's media field for the API consumer, but whose picker is the
e-commerce image modal (drop / choose from the computer) plus a third source, **the Strapi Media
Library**. Every picked image goes through a crop with zoom; only the final optimized WebP is kept, as a
file in the Media Library (with Strapi's own formats). An image picked from the Media Library is never
changed or deleted: the result is a new file.

The same crop-with-zoom replaces the Crop / Resize tabs of the e-commerce product and variant image
upload (there the size stays free).

## Goals

1. Custom field `ltbimage` (plugin `littlebox-strapi-suite`), registered on server and admin.
2. Field options (Content-Type Builder):
   - **Mode**: "Single image" | "Gallery" (default single).
   - **Width (px)** and **Height (px)**, optional, 1..6000.
   - **Lock this size** (checkbox), only effective when both width and height are set.
   - Advanced: **Required**; in gallery mode **Maximum images** (optional, ≥ 1).
3. The picker modal: drop / choose a file, or **Choose from the Media Library** (Strapi's own media
   library dialog, images only, one at a time). Then the crop step, then confirm.
4. Crop step (shared with e-commerce) — revised by the owner on 2026-11-26:
   - Output **width × height** inputs. The crop frame's aspect ratio is always width / height. When the
     size is free, a **Keep proportion** toggle (chain button, on by default) links the two inputs (editing
     one recomputes the other with the current ratio); off → independent. Not shown when the size is
     locked by the field.
   - The image sits under a fixed crop frame and can be:
     - dragged to move it;
     - zoomed with a slider and the mouse wheel / trackpad pinch (uniform scale);
     - resized with **handles** on its bounding box: corner handles scale keeping the image's current
       proportion; middle handles stretch one axis only (this deforms the image).
   - Buttons: **Fit width** (scale uniformly so the image width equals the frame width), **Fit height**
     (same for height), **Fill frame** (scale each axis so the image exactly matches the frame — may
     deform), and **Center** (centers the image without changing its size). Each fit/fill also centers
     the image. They are icon buttons whose icons show the action, with a tooltip.
   - Center guides: a thin red line (1px) appears when the image is centered horizontally in the frame,
     another when centered vertically, both when both. Moving near the center snaps to it (a few screen
     pixels).
   - Warnings: if the image does not cover the whole frame, an orange notice (#43311a, white text) and
     Confirm disabled; if the image is deformed (its horizontal and vertical scale differ by more than
     0.5%), a warning that it is deformed (Confirm allowed); if the cropped region has fewer pixels than
     the output (upscaling), a quality warning (Confirm allowed).
   - Output: the frame's region in the original's pixels, resized to exactly width × height
     (`fit: fill`, so a deformation chosen by the user is kept), WebP 80. The server transform does not
     change.
5. Size options in the field modal:
   - No size set → free (initial size = the original fitted in 6000, as today).
   - Width and/or height set, not locked → pre-filled as a suggestion (a single set value: the other
     follows the original's proportion, as today); editable.
   - Both set and locked → shown, not editable; the result is always exactly that size.
6. Media Library storage: the result is created through Strapi's upload service (so Strapi generates
   `thumbnail` / `small` / `medium` / `large` formats and the file appears in the Media Library), in a
   Media Library folder named **"Littlebox"** (created if missing). File name: the original's name with
   `.webp`. Alt text is stored as the file's `alternativeText`.
7. Stored value (JSON column) and API answer: the Strapi media shape —
   `{ id, documentId, name, alternativeText, caption, width, height, formats, hash, ext, mime, size, url,
   previewUrl, provider, provider_metadata, createdAt, updatedAt }` — a single object or `null` in single
   mode; an array in gallery mode, in the stored order. Returned without `populate` (it is a plain
   value).
8. Field UI in the Content Manager edit view:
   - Single: an empty dropzone-like box ("Add image") or the image preview with actions
     (replace, edit alt, remove).
   - Gallery: thumbnails with drag-and-drop reorder (as the e-commerce gallery), "Add image", and per
     image the detail (preview, alt text, remove). Max images respected.
   - Clicking an image opens its detail (preview, size, alt text editable, Remove).
   - Respects the field's disabled / read-only state and shows the field error and hint.
9. File cleanup (only files this field created, i.e. files in the "Littlebox" folder created by the
   field's upload route):
   - When an image leaves the field (removed, replaced) and the entry is saved, or the entry is deleted,
     the result file (and its formats) is deleted from the Media Library **unless** it is still used by
     another value of any `ltbimage` field (another locale, the draft vs the published version, another
     entry or component).
   - A result uploaded in the modal but never saved in any entry (modal confirmed, entry not saved) is
     an orphan: orphans older than **24 h** are deleted lazily (on server start and on each upload,
     at most once per hour).
   - A Media Library original picked as the source is never deleted or modified.
10. E-commerce: product and variant image upload uses the new crop-with-zoom step (no Crop / Resize
    tabs; width / height free as today; the URL source tab, if present, keeps working). Storage of
    e-commerce images does not change (they stay outside the Media Library). The store logo is not
    changed.

## Non-goals / anti-goals

- No change to Strapi's own media field, upload plugin or Media Library UI.
- No separate Resize mode (the crop step covers it); an image is only deformed when the user stretches it, and they are warned.
- No per-field folder choice, no focal point, no formats other than WebP.
- Editing the result file directly in the Media Library (e.g. its alt text) is not synced back to the
  stored value (the value is a snapshot); alt text is edited in the field.
- Modules other than this field and the e-commerce image modal do not change.
- Strapi content-history versions are not considered when deciding whether a field file is still
  used: restoring an old history version can point at a file the field already deleted.

## Constraints

- Strapi 5 custom fields can only store a scalar type: the field type is `json`.
- Server processing reuses the existing sharp pipeline (`processImage`: auto-orient, extract, resize to
  exact size, WebP 80) and limits (max dimension 6000, max upload 15 MB).
- The source picked from the Media Library is read by the server (by file id), not by the browser
  (no CORS dependence): local provider reads the file from the public uploads folder; other providers
  fetch the file URL.
- Admin routes for the field require an authenticated admin user with the upload plugin's
  `plugin::upload.assets.create` permission (and `plugin::upload.read` to pick from the library).
- Search bars 38px; notices in #43311a with white text; design-system v2; en and pt copy.
- Existing values keep working if the field's size options change later (no re-processing).

## Left to the builder

- Component split, file and route names; whether the crop step is a shared component used by both the
  field modal and the e-commerce modal (preferred).
- How "still used elsewhere" is computed (scan the JSON of every attribute of type
  `plugin::littlebox-strapi-suite.ltbimage` across content types and components is acceptable for the
  expected size), and where the save/delete hooks live (document service middleware or db lifecycles).
- Exact copy (en / pt).
