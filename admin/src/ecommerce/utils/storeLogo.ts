
/** Largest store logo file accepted (400 KB), checked again by the server. */
export const MAX_LOGO_BYTES = 400 * 1024;

/** Image types the server accepts for the store logo (it converts them to PNG). */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

const ACCEPTED = new Set(LOGO_ACCEPT.split(','));

export function logoFileError(file: { size: number; type: string }): 'too_large' | 'invalid_type' | null {
  if (file.size > MAX_LOGO_BYTES) return 'too_large';
  if (!ACCEPTED.has(file.type)) return 'invalid_type';
  return null;
}

export function buildLogoForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}
