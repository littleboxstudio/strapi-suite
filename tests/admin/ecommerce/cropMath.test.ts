import { describe, it, expect } from 'vitest';
import { lockedHeight, toPixelCrop } from '../../../admin/src/ecommerce/utils/cropMath';

describe('cropMath', () => {
  it('computes the locked height from width and ratio', () => {
    expect(lockedHeight(1000, 4 / 3)).toBe(750);
    expect(lockedHeight(100, 3)).toBe(33);
  });
  it('converts percent area to pixels clamped to the image', () => {
    expect(toPixelCrop({ x: 90, y: 0, width: 20, height: 100 }, { width: 1000, height: 500 })).toEqual({
      x: 900, y: 0, width: 100, height: 500,
    });
  });
  it('handles an exact crop', () => {
    expect(toPixelCrop({ x: 10, y: 20, width: 50, height: 50 }, { width: 200, height: 100 })).toEqual({
      x: 20, y: 20, width: 100, height: 50,
    });
  });
});
