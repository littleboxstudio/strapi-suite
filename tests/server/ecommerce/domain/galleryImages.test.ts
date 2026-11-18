import { describe, it, expect } from 'vitest';
import {
  galleryCover,
  isGalleryPermutation,
  sortGallery,
} from '../../../../server/src/services/modules/ecommerce/domain/galleryImages';

describe('gallery images', () => {
  const rows = [
    { id: 3, position: 2, cover: false },
    { id: 1, position: 1, cover: null },
    { id: 2, position: 2, cover: false },
  ];

  it('sorts by position, then id', () => {
    expect(sortGallery(rows).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortGallery(null)).toEqual([]);
  });

  it('the cover is the marked image, else the first one', () => {
    expect(galleryCover(rows)?.id).toBe(1);
    expect(galleryCover([...rows, { id: 9, position: 5, cover: true }])?.id).toBe(9);
    // No image marked (images from before covers): the first one.
    expect(galleryCover(rows.filter((r) => r.id !== 1))?.id).toBe(2);
    expect(galleryCover([])).toBeNull();
  });

  it('a reorder must name every image of the gallery once', () => {
    expect(isGalleryPermutation([1, 2, 3], [3, 1, 2])).toBe(true);
    expect(isGalleryPermutation([], [])).toBe(true);
    expect(isGalleryPermutation([1, 2, 3], [3, 1])).toBe(false);
    expect(isGalleryPermutation([1, 2, 3], [3, 1, 1])).toBe(false);
    expect(isGalleryPermutation([1, 2, 3], [3, 1, 4])).toBe(false);
    expect(isGalleryPermutation([1, 2], ['1', 2])).toBe(false);
    expect(isGalleryPermutation([1, 2], null)).toBe(false);
  });
});
