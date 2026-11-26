import type { CropTransform } from '../../core/utils/imageCrop';

/**
 * The value an `ltbimage` field stores (the Strapi media shape, a snapshot of the Media Library
 * file). Same keys as the server's `MediaValue`.
 */
export type MediaValue = {
  id: number;
  documentId: string | null;
  name: string | null;
  alternativeText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  formats: Record<string, { url?: string | null } | undefined> | null;
  hash: string | null;
  ext: string | null;
  mime: string | null;
  /** Kilobytes, as Strapi stores it. */
  size: number | null;
  url: string | null;
  previewUrl: string | null;
  provider: string | null;
  provider_metadata: unknown | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ImageFieldMode = 'single' | 'gallery';

/** The field options as the Content-Type Builder saves them (`attribute.options`). */
export type ImageFieldOptions = {
  mode?: string;
  width?: number | string | null;
  height?: number | string | null;
  lockSize?: boolean;
  maxImages?: number | string | null;
};

export type ImageFieldConfig = {
  mode: ImageFieldMode;
  /** The suggested (or locked) output size; unset sides are undefined. */
  width?: number;
  height?: number;
  /** Both sides set and "Lock this size" checked: the result is always exactly that size. */
  sizeLocked: boolean;
  /** Gallery only; null = no limit. */
  maxImages: number | null;
};

const MAX_DIMENSION = 6000;

const positiveInt = (raw: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
};

/** Reads the field options with the same rules as the server (anything invalid is ignored). */
export function fieldConfig(options: ImageFieldOptions | null | undefined): ImageFieldConfig {
  const mode: ImageFieldMode = options?.mode === 'gallery' ? 'gallery' : 'single';
  const width = positiveInt(options?.width, MAX_DIMENSION);
  const height = positiveInt(options?.height, MAX_DIMENSION);
  return {
    mode,
    width,
    height,
    sizeLocked: !!options?.lockSize && width !== undefined && height !== undefined,
    maxImages: mode === 'gallery' ? (positiveInt(options?.maxImages) ?? null) : null,
  };
}

const isMedia = (v: unknown): v is MediaValue =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof (v as any).id === 'number' &&
  Number.isInteger((v as any).id) &&
  (v as any).id > 0;

/** The form may hold the JSON as text (e.g. a value typed in the raw JSON editor before). */
const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** The single-mode image, or null (anything that is not an image object reads as empty). */
export function toSingle(value: unknown): MediaValue | null {
  const v = parsed(value);
  if (isMedia(v)) return v;
  // A value saved while the field was a gallery: its first image.
  if (Array.isArray(v)) return v.find(isMedia) ?? null;
  return null;
}

/** The gallery's images in their order (non-image entries dropped). */
export function toGallery(value: unknown): MediaValue[] {
  const v = parsed(value);
  if (Array.isArray(v)) return v.filter(isMedia);
  return isMedia(v) ? [v] : [];
}

/** Whether one more image fits in the gallery. */
export function canAdd(images: readonly MediaValue[], maxImages: number | null): boolean {
  return maxImages === null || images.length < maxImages;
}

/** The gallery with `image` appended (ignored when full or already present). */
export function addImage(
  images: MediaValue[],
  image: MediaValue,
  maxImages: number | null
): MediaValue[] {
  if (!canAdd(images, maxImages) || images.some((i) => i.id === image.id)) return images;
  return [...images, image];
}

export function removeImage(images: MediaValue[], id: number): MediaValue[] {
  return images.filter((i) => i.id !== id);
}

/** The gallery with the image `id` replaced in place by `image` (alt text edits, replacement). */
export function replaceImage(images: MediaValue[], id: number, image: MediaValue): MediaValue[] {
  return images.map((i) => (i.id === id ? image : i));
}

/** The gallery with `id` moved to `toIndex` (the others keep their relative order). */
export function moveImage(images: MediaValue[], id: number, toIndex: number): MediaValue[] {
  const from = images.findIndex((i) => i.id === id);
  if (from < 0) return images;
  const rest = images.filter((i) => i.id !== id);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  return [...rest.slice(0, at), images[from], ...rest.slice(at)];
}

/** Whether two galleries list the same images in the same order. */
export function sameOrder(a: readonly MediaValue[], b: readonly MediaValue[]): boolean {
  return a.length === b.length && a.every((image, i) => image.id === b[i].id);
}

/** A relative upload url (local provider) made absolute with the backend's url. */
export function absoluteUrl(url: string | null | undefined, backendURL: string): string | null {
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:'))
    return url;
  return `${backendURL.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** The url of the smallest Strapi format at least as good as a thumbnail, else the original. */
export function thumbnailUrl(image: MediaValue): string | null {
  const formats = image.formats ?? {};
  for (const key of ['thumbnail', 'small', 'medium']) {
    const url = formats[key]?.url;
    if (url) return url;
  }
  return image.url;
}

/** A Media Library asset the picker returned: usable as a crop source when it is an image. */
export function isImageAsset(asset: { mime?: string | null; id?: unknown } | null | undefined) {
  return !!asset && typeof asset.id === 'number' && /^image\//i.test(asset.mime ?? '');
}

export type UploadSource = { file: File } | { sourceFileId: number };

/** The multipart body of `POST /image-field/upload`. */
export function buildFieldUploadForm(
  source: UploadSource,
  transform: CropTransform,
  alternativeText: string
): FormData {
  const form = new FormData();
  if ('file' in source) form.append('file', source.file);
  else form.append('sourceFileId', String(source.sourceFileId));
  form.append('transform', JSON.stringify(transform));
  form.append('alternativeText', alternativeText.trim());
  return form;
}

/** The translation key (under `image.field.`) for a failed upload. */
export function uploadErrorKey(status: number | null, code: string | null): string {
  if (status === 403) return 'upload.forbidden';
  if (code === 'IMAGE_TOO_LARGE') return 'upload.tooLarge';
  if (code === 'INVALID_IMAGE') return 'upload.invalidImage';
  if (code && code.startsWith('SOURCE_')) return 'upload.sourceError';
  return 'upload.error';
}
