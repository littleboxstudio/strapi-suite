/** A gallery image as stored: its id, its place in the gallery and whether it was marked as cover. */
export type GalleryImage = { id: number; position?: number | null; cover?: boolean | null };

/** Gallery order: position, then id (older first) for equal positions. */
export const byGalleryPosition = (a: GalleryImage, b: GalleryImage): number =>
  (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;

/** The images in gallery order (a copy; the input is not changed). */
export function sortGallery<T extends GalleryImage>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort(byGalleryPosition);
}

/**
 * The gallery's cover: the image marked as cover. Uploads, deletes and reorders keep one marked;
 * a gallery with none marked (images from before covers) falls back to its first image. Null for
 * an empty gallery.
 */
export function galleryCover<T extends GalleryImage>(rows: T[] | null | undefined): T | null {
  const sorted = sortGallery(rows);
  return sorted.find((r) => r.cover === true) ?? sorted[0] ?? null;
}

/**
 * Whether `ids` is exactly the gallery's images, each once (a reorder must name all of them, so
 * a gallery changed meanwhile, by another tab or admin, is refused rather than half reordered).
 */
export function isGalleryPermutation(currentIds: number[], ids: unknown): ids is number[] {
  if (!Array.isArray(ids) || ids.length !== currentIds.length) return false;
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) return false;
  const given = new Set(ids as number[]);
  return given.size === ids.length && currentIds.every((id) => given.has(id));
}
