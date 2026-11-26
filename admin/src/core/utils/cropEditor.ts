import type { Rect, Size } from './imageCrop';

/**
 * Geometry of the crop editor, all in viewport pixels: a fixed `frame` (the crop area, aspect = output
 * width / height) and the `image` box (where the original is drawn; it may be stretched on one axis).
 */
export type Box = Rect;
export type Point = { x: number; y: number };
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type ZoomLimits = { min: number; max: number };

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Smallest side of the image box while resizing with a handle. */
export const MIN_IMAGE_SIDE = 8;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const centredAt = (point: Point, width: number, height: number): Box => ({
  x: point.x - width / 2,
  y: point.y - height / 2,
  width,
  height,
});

/** The frame: as large as fits the viewport minus padding, centred, with the output's aspect. */
export function frameIn(viewport: Size, output: Size, padding: number): Box {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const aspect = output.width / output.height;
  const width = Math.min(availableWidth, availableHeight * aspect);
  const height = width / aspect;
  return centredAt({ x: viewport.width / 2, y: viewport.height / 2 }, width, height);
}

/** The image box contains the frame (within `tol` pixels). */
export function covers(frame: Box, image: Box, tol = 0.5): boolean {
  return (
    image.x <= frame.x + tol &&
    image.y <= frame.y + tol &&
    image.x + image.width >= frame.x + frame.width - tol &&
    image.y + image.height >= frame.y + frame.height - tol
  );
}

/** The horizontal and vertical scales differ by more than `tol` (0.5 %). */
export function isDeformed(image: Box, natural: Size, tol = 0.005): boolean {
  const scaleX = image.width / natural.width;
  const scaleY = image.height / natural.height;
  return Math.abs(scaleX / scaleY - 1) > tol;
}

/** The frame in the original's whole pixels, kept inside the original (meaningful when it covers). */
export function toSourceCrop(frame: Box, image: Box, natural: Size): Rect {
  const scaleX = image.width / natural.width;
  const scaleY = image.height / natural.height;
  const edge = (v: number, max: number) => clamp(Math.round(v), 0, max);
  const left = edge((frame.x - image.x) / scaleX, natural.width);
  const right = edge((frame.x + frame.width - image.x) / scaleX, natural.width);
  const top = edge((frame.y - image.y) / scaleY, natural.height);
  const bottom = edge((frame.y + frame.height - image.y) / scaleY, natural.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Same size, centred on the frame. */
export function centerImage(frame: Box, image: Box): Box {
  return centredAt(center(frame), image.width, image.height);
}

/** Image width = frame width, keeping the image's current proportion; centred. */
export function fitWidth(frame: Box, image: Box): Box {
  const width = frame.width;
  return centredAt(center(frame), width, (width * image.height) / image.width);
}

/** Image height = frame height, keeping the image's current proportion; centred. */
export function fitHeight(frame: Box, image: Box): Box {
  const height = frame.height;
  return centredAt(center(frame), (height * image.width) / image.height, height);
}

/** The image matches the frame exactly (may deform it). */
export function fillFrame(frame: Box): Box {
  return { ...frame };
}

/** The original at its own proportion, just covering the frame, centred: the starting position. */
export function coverImage(frame: Box, natural: Size): Box {
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height);
  return centredAt(center(frame), natural.width * scale, natural.height * scale);
}

/** Bounds of the image's larger side: the frame's shorter side × 0.1 up to the original × 10. */
export function zoomLimits(frame: Box, natural: Size): ZoomLimits {
  return {
    min: Math.min(frame.width, frame.height) * 0.1,
    max: Math.max(natural.width, natural.height) * 10,
  };
}

/** Uniform scale around `origin`, the image's larger side kept within the limits. */
export function zoomAt(image: Box, factor: number, origin: Point, limits: ZoomLimits): Box {
  const side = Math.max(image.width, image.height);
  const f = clamp(side * factor, limits.min, limits.max) / side;
  return {
    x: origin.x + (image.x - origin.x) * f,
    y: origin.y + (image.y - origin.y) * f,
    width: image.width * f,
    height: image.height * f,
  };
}

/** The image's mean scale relative to the scale that just covers the frame (1 = covers exactly). */
export function zoomLevel(frame: Box, image: Box, natural: Size): number {
  const scale = Math.sqrt((image.width / natural.width) * (image.height / natural.height));
  const coverScale = Math.max(frame.width / natural.width, frame.height / natural.height);
  return scale / coverScale;
}

/**
 * Resizes with a handle moved by (dx, dy); the opposite side / corner stays fixed. Edges change one
 * axis; corners keep the current proportion when `keepRatio`, otherwise change both axes freely.
 */
export function resizeWithHandle(
  image: Box,
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio: boolean
): Box {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  let width = sx ? image.width + sx * dx : image.width;
  let height = sy ? image.height + sy * dy : image.height;

  if (sx && sy && keepRatio) {
    const rx = width / image.width;
    const ry = height / image.height;
    const minScale = Math.max(MIN_IMAGE_SIDE / image.width, MIN_IMAGE_SIDE / image.height);
    const scale = Math.max(Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry, minScale);
    width = image.width * scale;
    height = image.height * scale;
  } else {
    width = Math.max(width, MIN_IMAGE_SIDE);
    height = Math.max(height, MIN_IMAGE_SIDE);
  }

  const right = image.x + image.width;
  const bottom = image.y + image.height;
  return {
    x: sx === -1 ? right - width : image.x,
    y: sy === -1 ? bottom - height : image.y,
    width,
    height,
  };
}

/**
 * Snaps the image centre to the frame centre on each axis within `threshold` pixels; the flags say
 * which axes are centred (they draw the red guides).
 */
export function snapToCenter(
  frame: Box,
  image: Box,
  threshold = 6
): { image: Box; centeredX: boolean; centeredY: boolean } {
  const target = center(frame);
  const current = center(image);
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const centeredX = Math.abs(dx) <= threshold;
  const centeredY = Math.abs(dy) <= threshold;
  if (!(centeredX && dx !== 0) && !(centeredY && dy !== 0)) {
    return { image, centeredX, centeredY };
  }
  return {
    image: {
      ...image,
      x: centeredX ? image.x + dx : image.x,
      y: centeredY ? image.y + dy : image.y,
    },
    centeredX,
    centeredY,
  };
}

/**
 * The frame moved / resized (viewport or output size changed): keeps the image's framing by scaling it
 * uniformly (the larger of the frame's two changes) around the frame centre.
 */
export function rescaleForFrame(prev: Box, next: Box, image: Box): Box {
  const scale = Math.max(next.width / prev.width, next.height / prev.height);
  const from = center(prev);
  const to = center(next);
  const c = center(image);
  return centredAt(
    { x: to.x + (c.x - from.x) * scale, y: to.y + (c.y - from.y) * scale },
    image.width * scale,
    image.height * scale
  );
}
