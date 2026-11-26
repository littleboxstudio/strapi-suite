import { describe, it, expect } from 'vitest';
import {
  centerImage,
  coverImage,
  covers,
  fillFrame,
  fitHeight,
  fitWidth,
  frameIn,
  isDeformed,
  rescaleForFrame,
  resizeWithHandle,
  snapToCenter,
  toSourceCrop,
  zoomAt,
  zoomLevel,
  zoomLimits,
} from '../../admin/src/core/utils/cropEditor';

const frame = { x: 100, y: 50, width: 400, height: 200 };

describe('frameIn', () => {
  it('is as large as fits the viewport with padding, centred, with the output aspect', () => {
    expect(frameIn({ width: 600, height: 320 }, { width: 1000, height: 1000 }, 10)).toEqual({
      x: 150,
      y: 10,
      width: 300,
      height: 300,
    });
    expect(frameIn({ width: 600, height: 320 }, { width: 4000, height: 1000 }, 10)).toEqual({
      x: 10,
      y: 87.5,
      width: 580,
      height: 145,
    });
  });
});

describe('covers', () => {
  it('is true when the image box contains the frame, edges included', () => {
    expect(covers(frame, { ...frame })).toBe(true);
    expect(covers(frame, { x: 0, y: 0, width: 600, height: 300 })).toBe(true);
  });

  it('accepts a sub-pixel gap within the tolerance', () => {
    expect(covers(frame, { x: 100.4, y: 50, width: 399.6, height: 200 })).toBe(true);
  });

  it('is false when a side of the frame is left empty', () => {
    expect(covers(frame, { x: 101, y: 50, width: 399, height: 200 })).toBe(false);
    expect(covers(frame, { x: 100, y: 50, width: 399, height: 200 })).toBe(false);
    expect(covers(frame, { x: 100, y: 51, width: 400, height: 199 })).toBe(false);
    expect(covers(frame, { x: 100, y: 50, width: 400, height: 199 })).toBe(false);
  });
});

describe('isDeformed', () => {
  const natural = { width: 1000, height: 500 };

  it('is false when both axes have the same scale (within 0.5%)', () => {
    expect(isDeformed({ x: 0, y: 0, width: 500, height: 250 }, natural)).toBe(false);
    expect(isDeformed({ x: 0, y: 0, width: 502, height: 250 }, natural)).toBe(false);
  });

  it('is true when the axes differ by more than 0.5%', () => {
    expect(isDeformed({ x: 0, y: 0, width: 503, height: 250 }, natural)).toBe(true);
    expect(isDeformed({ x: 0, y: 0, width: 500, height: 300 }, natural)).toBe(true);
  });
});

describe('toSourceCrop', () => {
  it('expresses the frame in original pixels', () => {
    // scale 0.5 on both axes; the frame starts 50 px right and 25 px below the image's corner
    const image = { x: 50, y: 25, width: 500, height: 250 };
    expect(toSourceCrop(frame, image, { width: 1000, height: 500 })).toEqual({
      x: 100,
      y: 50,
      width: 800,
      height: 400,
    });
  });

  it('rounds to whole pixels', () => {
    const image = { x: 99.7, y: 49.8, width: 400.6, height: 200.4 };
    expect(toSourceCrop(frame, image, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });

  it('keeps the region inside the original', () => {
    const image = { x: 120, y: 60, width: 400, height: 200 };
    expect(toSourceCrop(frame, image, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 380,
      height: 190,
    });
  });
});

describe('fit and fill', () => {
  const image = { x: 0, y: 0, width: 200, height: 50 }; // ratio 4:1

  it('fitWidth matches the frame width keeping the image proportion, centred', () => {
    expect(fitWidth(frame, image)).toEqual({ x: 100, y: 100, width: 400, height: 100 });
  });

  it('fitHeight matches the frame height keeping the image proportion, centred', () => {
    expect(fitHeight(frame, image)).toEqual({ x: -100, y: 50, width: 800, height: 200 });
  });

  it('fillFrame matches the frame exactly', () => {
    expect(fillFrame(frame)).toEqual(frame);
  });

  it('centerImage centres without changing the size', () => {
    expect(centerImage(frame, image)).toEqual({ x: 200, y: 125, width: 200, height: 50 });
  });

  it('coverImage covers the frame at the original proportion, centred', () => {
    expect(coverImage(frame, { width: 1000, height: 1000 })).toEqual({
      x: 100,
      y: -50,
      width: 400,
      height: 400,
    });
  });
});

describe('zoom', () => {
  const natural = { width: 1000, height: 500 };

  it('scales uniformly around the origin', () => {
    const image = { x: 0, y: 0, width: 200, height: 100 };
    expect(zoomAt(image, 2, { x: 100, y: 50 }, { min: 1, max: 10000 })).toEqual({
      x: -100,
      y: -50,
      width: 400,
      height: 200,
    });
  });

  it('clamps the larger side to the limits', () => {
    const image = { x: 0, y: 0, width: 200, height: 100 };
    expect(zoomAt(image, 100, { x: 0, y: 0 }, { min: 1, max: 1000 }).width).toBe(1000);
    expect(zoomAt(image, 0.001, { x: 0, y: 0 }, { min: 20, max: 1000 })).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
  });

  it('limits: frame shorter side × 0.1 to the original × 10', () => {
    expect(zoomLimits(frame, natural)).toEqual({ min: 20, max: 10000 });
  });

  it('zoomLevel is 1 when the image just covers the frame', () => {
    expect(zoomLevel(frame, coverImage(frame, natural), natural)).toBeCloseTo(1);
    expect(zoomLevel(frame, { x: 0, y: 0, width: 800, height: 400 }, natural)).toBeCloseTo(2);
  });
});

describe('resizeWithHandle', () => {
  const image = { x: 100, y: 100, width: 200, height: 100 };

  it('an east edge stretches the width only, the west side stays', () => {
    expect(resizeWithHandle(image, 'e', 50, 30, true)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    });
  });

  it('a north edge stretches the height only, the bottom stays', () => {
    expect(resizeWithHandle(image, 'n', 10, -20, true)).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 120,
    });
  });

  it('a corner keeps the proportion with the opposite corner fixed', () => {
    // nw grows: the south-east corner (300, 200) stays put
    expect(resizeWithHandle(image, 'nw', -100, -10, true)).toEqual({
      x: 0,
      y: 50,
      width: 300,
      height: 150,
    });
  });

  it('a free corner changes both axes independently', () => {
    expect(resizeWithHandle(image, 'se', 20, 50, false)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 150,
    });
  });

  it('never goes below 8 px, keeping the opposite side', () => {
    expect(resizeWithHandle(image, 'w', 500, 0, true)).toEqual({
      x: 292,
      y: 100,
      width: 8,
      height: 100,
    });
    const shrunk = resizeWithHandle(image, 'se', -1000, -1000, true);
    expect(shrunk.height).toBe(8);
    expect(shrunk.width).toBe(16);
    expect(shrunk.x).toBe(100);
  });
});

describe('snapToCenter', () => {
  // frame centre is (300, 150)
  it('snaps each axis within the threshold and flags it', () => {
    const image = { x: 104, y: 0, width: 400, height: 280 }; // centre (304, 140)
    expect(snapToCenter(frame, image)).toEqual({
      image: { x: 100, y: 0, width: 400, height: 280 },
      centeredX: true,
      centeredY: false,
    });
  });

  it('leaves the image alone beyond the threshold', () => {
    const image = { x: 107, y: 17, width: 400, height: 280 }; // centre (307, 157)
    expect(snapToCenter(frame, image)).toEqual({ image, centeredX: false, centeredY: false });
  });

  it('flags both axes when centred', () => {
    const image = { x: 50, y: 0, width: 500, height: 300 };
    const result = snapToCenter(frame, image, 0.5);
    expect(result.centeredX && result.centeredY).toBe(true);
  });
});

describe('rescaleForFrame', () => {
  it('keeps the image relation to the frame when the frame scales', () => {
    const prev = { x: 100, y: 0, width: 200, height: 200 };
    const next = { x: 0, y: 0, width: 400, height: 400 };
    expect(rescaleForFrame(prev, next, { x: 150, y: 50, width: 100, height: 100 })).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
  });

  it('scales uniformly by the larger change when the frame aspect changes, around the centre', () => {
    const prev = { x: 0, y: 0, width: 200, height: 200 };
    const next = { x: 0, y: 50, width: 400, height: 100 };
    expect(rescaleForFrame(prev, next, { ...prev })).toEqual({
      x: 0,
      y: -100,
      width: 400,
      height: 400,
    });
  });
});
