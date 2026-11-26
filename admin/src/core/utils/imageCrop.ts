export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Largest output side, the same limit the server enforces. */
export const MAX_CROP_DIMENSION = 6000;

const clampDimension = (n: number) => Math.min(Math.max(Math.round(n), 1), MAX_CROP_DIMENSION);

/** The cropped region has fewer pixels than the output in some dimension. */
export function isUpscale(pixelCrop: Rect, output: Size): boolean {
  return pixelCrop.width < output.width || pixelCrop.height < output.height;
}

const isSet = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The output size the crop step starts with: the preset when both sides are set; one side set → the
 * other follows the original's proportion; none → the original fitted in the maximum dimension.
 */
export function startSize(natural: Size, preset: { width?: number; height?: number }): Size {
  const ratio = natural.width / natural.height;
  if (isSet(preset.width) && isSet(preset.height)) {
    return { width: clampDimension(preset.width), height: clampDimension(preset.height) };
  }
  if (isSet(preset.width)) {
    return { width: clampDimension(preset.width), height: clampDimension(preset.width / ratio) };
  }
  if (isSet(preset.height)) {
    return { width: clampDimension(preset.height * ratio), height: clampDimension(preset.height) };
  }
  const scale = Math.min(1, MAX_CROP_DIMENSION / Math.max(natural.width, natural.height));
  return {
    width: clampDimension(natural.width * scale),
    height: clampDimension(natural.height * scale),
  };
}

/** The other side for a width at a given width / height ratio (whole pixels). */
export function lockedHeight(width: number, ratio: number): number {
  return Math.round(width / ratio);
}

/** The crop the server applies: the region `crop` of the original, resized to exactly width × height. */
export type CropTransform = { mode: 'crop'; width: number; height: number; crop: Rect };

/**
 * The crop warnings in the order they appeared: the ones no longer active leave, newly active ones
 * join at the end (in the given order). The last one is the one shown.
 */
export function warningOrder<K extends string>(previous: K[], active: Record<K, boolean>): K[] {
  const kept = previous.filter((k) => active[k]);
  const added = (Object.keys(active) as K[]).filter((k) => active[k] && !kept.includes(k));
  return [...kept, ...added];
}
