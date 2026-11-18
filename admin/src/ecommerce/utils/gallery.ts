import type { ImageRecord } from '../types';

/** The gallery with `id` moved to `toIndex` (the others keep their relative order). */
export function moveImage(images: ImageRecord[], id: number, toIndex: number): ImageRecord[] {
  const from = images.findIndex((i) => i.id === id);
  if (from < 0) return images;
  const rest = images.filter((i) => i.id !== id);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  return [...rest.slice(0, at), images[from], ...rest.slice(at)];
}

/** Whether two galleries list the same images in the same order. */
export function sameOrder(a: ImageRecord[], b: ImageRecord[]): boolean {
  return a.length === b.length && a.every((image, i) => image.id === b[i].id);
}

/** The gallery with only `coverId` flagged as cover. */
export function withCover(images: ImageRecord[], coverId: number | null): ImageRecord[] {
  return images.map((i) => (i.cover === (i.id === coverId) ? i : { ...i, cover: i.id === coverId }));
}

/** The gallery's cover image, else its first one. */
export function coverImage(images: ImageRecord[]): ImageRecord | null {
  return images.find((i) => i.cover) ?? images[0] ?? null;
}

/** The gallery once `id` is deleted: deleting the cover makes the first image the cover. */
export function withoutImage(images: ImageRecord[], id: number): ImageRecord[] {
  const deleted = images.find((i) => i.id === id);
  const rest = images.filter((i) => i.id !== id);
  return deleted?.cover ? withCover(rest, rest[0]?.id ?? null) : rest;
}
