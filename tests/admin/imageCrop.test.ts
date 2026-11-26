import { describe, it, expect } from 'vitest';
import {
  isUpscale,
  lockedHeight,
  startSize,
  warningOrder,
} from '../../admin/src/core/utils/imageCrop';

describe('isUpscale', () => {
  it('is true when the crop has fewer pixels than the output in either dimension', () => {
    expect(isUpscale({ x: 0, y: 0, width: 799, height: 1000 }, { width: 800, height: 600 })).toBe(
      true
    );
    expect(isUpscale({ x: 0, y: 0, width: 1000, height: 599 }, { width: 800, height: 600 })).toBe(
      true
    );
  });

  it('is false when the crop is at least the output size', () => {
    expect(isUpscale({ x: 0, y: 0, width: 800, height: 600 }, { width: 800, height: 600 })).toBe(
      false
    );
    expect(isUpscale({ x: 5, y: 5, width: 2000, height: 1500 }, { width: 800, height: 600 })).toBe(
      false
    );
  });
});

describe('startSize', () => {
  const natural = { width: 4000, height: 2000 };

  it('uses the preset when both dimensions are set', () => {
    expect(startSize(natural, { width: 800, height: 800 })).toEqual({ width: 800, height: 800 });
  });

  it('derives the height from the original proportion when only the width is set', () => {
    expect(startSize(natural, { width: 1000 })).toEqual({ width: 1000, height: 500 });
  });

  it('derives the width from the original proportion when only the height is set', () => {
    expect(startSize(natural, { height: 300 })).toEqual({ width: 600, height: 300 });
  });

  it('keeps the original size when no preset is set', () => {
    expect(startSize(natural, {})).toEqual({ width: 4000, height: 2000 });
  });

  it('fits a large original into 6000 keeping its proportion', () => {
    expect(startSize({ width: 9000, height: 3000 }, {})).toEqual({ width: 6000, height: 2000 });
    expect(startSize({ width: 3000, height: 9000 }, {})).toEqual({ width: 2000, height: 6000 });
  });

  it('clamps derived and preset values to 1..6000', () => {
    expect(startSize({ width: 1000, height: 4000 }, { width: 2000 })).toEqual({
      width: 2000,
      height: 6000,
    });
    expect(startSize({ width: 4000, height: 1000 }, { height: 2000 })).toEqual({
      width: 6000,
      height: 2000,
    });
    expect(startSize({ width: 10000, height: 1 }, { width: 100 })).toEqual({
      width: 100,
      height: 1,
    });
    expect(startSize(natural, { width: 7000, height: 7000 })).toEqual({
      width: 6000,
      height: 6000,
    });
  });
});

describe('lockedHeight', () => {
  it('computes the other side from the ratio, rounded', () => {
    expect(lockedHeight(1000, 4 / 3)).toBe(750);
    expect(lockedHeight(100, 3)).toBe(33);
  });
});

describe('warningOrder', () => {
  const none = { mustCover: false, deformed: false, upscale: false };

  it('appends newly active warnings, so the latest is last', () => {
    let order = warningOrder([], { ...none, deformed: true });
    expect(order).toEqual(['deformed']);
    order = warningOrder(order, { ...none, deformed: true, mustCover: true });
    expect(order).toEqual(['deformed', 'mustCover']);
  });

  it('falls back to the previous warning when the latest is resolved', () => {
    const order = warningOrder(['deformed', 'mustCover'], { ...none, deformed: true });
    expect(order).toEqual(['deformed']);
  });

  it('drops warnings no longer active and keeps the rest in order', () => {
    expect(
      warningOrder(['upscale', 'deformed', 'mustCover'], {
        ...none,
        upscale: true,
        mustCover: true,
      })
    ).toEqual(['upscale', 'mustCover']);
    expect(warningOrder(['upscale'], none)).toEqual([]);
  });

  it('a warning that comes back becomes the latest again', () => {
    const order = warningOrder(['mustCover'], { ...none, mustCover: true, deformed: true });
    expect(
      warningOrder(warningOrder(order, { ...none, mustCover: true }), {
        ...none,
        mustCover: true,
        deformed: true,
      })
    ).toEqual(['mustCover', 'deformed']);
  });
});

describe('warningOrder — simultaneous', () => {
  it('warnings that appear together follow the given key order (the last listed is shown)', () => {
    expect(warningOrder([], { deformed: true, upscale: false, mustCover: true })).toEqual([
      'deformed',
      'mustCover',
    ]);
  });
});
