/** Strapi stores a `string` attribute in a varchar(255) column when it sets no maxLength. */
export const STRING_COLUMN_LENGTH = 255;

/**
 * The most characters a text attribute accepts: its `maxLength`, else 255 for a `string` (the
 * database column). Undefined when there is no limit (text, rich text and blocks without one).
 */
export function fieldMaxLength(attribute: any): number | undefined {
  const max = attribute?.maxLength;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) return Math.floor(max);
  return attribute?.type === 'string' ? STRING_COLUMN_LENGTH : undefined;
}
