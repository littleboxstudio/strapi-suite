import { describe, it, expect } from 'vitest';
import {
  coverImage,
  moveImage,
  sameOrder,
  withCover,
  withoutImage,
} from '../../../admin/src/ecommerce/utils/gallery';
import en from '../../../admin/src/core/translations/en.json';
import pt from '../../../admin/src/core/translations/pt.json';

const img = (id: number, cover = false) =>
  ({ id, name: `${id}.webp`, width: 1, height: 1, sizeBytes: 1, url: `/u/${id}`, position: id, cover }) as any;
const ids = (list: { id: number }[]) => list.map((i) => i.id);

describe('gallery utils', () => {
  it('moves an image to an index, the others keep their order', () => {
    const list = [img(1), img(2), img(3), img(4)];
    expect(ids(moveImage(list, 4, 0))).toEqual([4, 1, 2, 3]);
    expect(ids(moveImage(list, 1, 2))).toEqual([2, 3, 1, 4]);
    expect(ids(moveImage(list, 2, 9))).toEqual([1, 3, 4, 2]);
    expect(moveImage(list, 7, 0)).toBe(list);
  });

  it('compares orders', () => {
    expect(sameOrder([img(1), img(2)], [img(1), img(2)])).toBe(true);
    expect(sameOrder([img(1), img(2)], [img(2), img(1)])).toBe(false);
  });

  it('flags a single cover; the cover falls back to the first image', () => {
    const list = withCover([img(1, true), img(2), img(3)], 3);
    expect(list.map((i) => i.cover)).toEqual([false, false, true]);
    expect(coverImage(list)?.id).toBe(3);
    expect(coverImage([img(5), img(6)])?.id).toBe(5);
    expect(coverImage([])).toBeNull();
  });

  it('deleting the cover makes the first image the cover; deleting another keeps it', () => {
    expect(withoutImage([img(1), img(2, true), img(3)], 2).map((i) => [i.id, i.cover])).toEqual([
      [1, true],
      [3, false],
    ]);
    expect(withoutImage([img(1), img(2, true), img(3)], 3).map((i) => [i.id, i.cover])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(withoutImage([img(1, true)], 1)).toEqual([]);
  });

  it('has the cover and order texts', () => {
    for (const k of [
      'ecommerce.image.cover',
      'ecommerce.image.reorderHint',
      'ecommerce.image.reorderError',
      'ecommerce.image.detail.setCover',
      'ecommerce.image.detail.setCoverError',
    ]) {
      expect((en as any)[`littlebox-strapi-suite.${k}`]).toBeTruthy();
      expect((pt as any)[`littlebox-strapi-suite.${k}`]).toBeTruthy();
    }
  });
});
