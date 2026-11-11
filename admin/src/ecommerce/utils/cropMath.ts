export type Rect = { x: number; y: number; width: number; height: number };

export function lockedHeight(width: number, ratio: number): number {
  return Math.round(width / ratio);
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function toPixelCrop(areaPercent: Rect, natural: { width: number; height: number }): Rect {
  const x = clamp(Math.round((areaPercent.x / 100) * natural.width), 0, natural.width);
  const y = clamp(Math.round((areaPercent.y / 100) * natural.height), 0, natural.height);
  const width = clamp(Math.round((areaPercent.width / 100) * natural.width), 0, natural.width - x);
  const height = clamp(Math.round((areaPercent.height / 100) * natural.height), 0, natural.height - y);
  return { x, y, width, height };
}
