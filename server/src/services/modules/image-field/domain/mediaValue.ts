/**
 * The value an `ltbimage` field stores and answers: the Strapi media shape, as a plain snapshot of
 * the Media Library file (no relation, no populate needed).
 */
export type MediaValue = {
  id: number;
  documentId: string | null;
  name: string | null;
  alternativeText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  formats: Record<string, unknown> | null;
  hash: string | null;
  ext: string | null;
  mime: string | null;
  size: number | null;
  url: string | null;
  previewUrl: string | null;
  provider: string | null;
  provider_metadata: unknown | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const MEDIA_VALUE_KEYS = [
  'id',
  'documentId',
  'name',
  'alternativeText',
  'caption',
  'width',
  'height',
  'formats',
  'hash',
  'ext',
  'mime',
  'size',
  'url',
  'previewUrl',
  'provider',
  'provider_metadata',
  'createdAt',
  'updatedAt',
] as const;

const toIso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'string' ? v : null;
};

/** Picks exactly the media keys from an upload file (anything else, e.g. folder or related, is dropped). */
export function toMediaValue(file: any): MediaValue {
  const out: Record<string, unknown> = {};
  for (const key of MEDIA_VALUE_KEYS) {
    const v = file?.[key];
    out[key] = v === undefined ? null : v;
  }
  out.createdAt = toIso(file?.createdAt);
  out.updatedAt = toIso(file?.updatedAt);
  return out as MediaValue;
}
