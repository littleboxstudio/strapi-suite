import type { Rect } from './cropMath';

/** Same limits the server enforces on POST /admin/ecommerce/images. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 6000;

export type ImageTransform =
  | { mode: 'crop'; width: number; height: number; crop: Rect }
  | { mode: 'resize'; width: number; height: number };

export type ImageOwner = { productId?: number; variantId?: number };

export function formatBytes(bytes: number): string {
  const mb = 1024 * 1024;
  return bytes >= mb ? `${(bytes / mb).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function isValidDimension(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_IMAGE_DIMENSION;
}

/** Digits only: anything else (blank, decimals, signs) is NaN. */
export function parseDimension(value: string): number {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
}

/** `ctx.badRequest('Invalid image', { error: { code } })` nests the code under `details`. */
export function imageErrorCode(err: unknown): string | null {
  const code = (err as any)?.response?.data?.error?.details?.error?.code;
  return typeof code === 'string' ? code : null;
}

export function buildUploadForm(file: File, transform: ImageTransform, owner: ImageOwner): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('transform', JSON.stringify(transform));
  if (owner.variantId !== undefined) form.append('variantId', String(owner.variantId));
  else if (owner.productId !== undefined) form.append('productId', String(owner.productId));
  return form;
}
