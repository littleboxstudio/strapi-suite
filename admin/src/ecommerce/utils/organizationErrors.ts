import type { OrganizationIssue } from '../organizationTypes';

/** State conflicts (409) of categories, tags and collections: shown as a message. */
export const ORGANIZATION_CONFLICT_CODES = [
  'NAME_TAKEN',
  'CATEGORY_HAS_CHILDREN',
  'IN_USE_BY_COLLECTIONS',
  'CATEGORY_CYCLE',
  'CATEGORY_TOO_DEEP',
  'COLLECTION_IS_AUTOMATED',
] as const;

/** Field validation codes (400) with a text under `ecommerce.organization.errors.*`. */
export const ORGANIZATION_FIELD_CODES = [
  'required',
  'duplicate_slug',
  'invalid_url',
  'too_long',
  'invalid_locale',
  'unknown',
  'immutable',
  'invalid',
  'not_permutation',
  'too_many',
] as const;

const KNOWN = new Set<string>([...ORGANIZATION_CONFLICT_CODES, ...ORGANIZATION_FIELD_CODES]);

/** The issues of an API error answer (`error.details.errors`); empty for anything else. */
export function organizationIssues(err: unknown): OrganizationIssue[] {
  const list = (err as any)?.response?.data?.error?.details?.errors;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.path === 'string' && typeof e.code === 'string')
    .map((e) => (typeof e.detail === 'string' ? { path: e.path, code: e.code, detail: e.detail } : { path: e.path, code: e.code }));
}

/**
 * The message for a state conflict in the answer (translation id without the plugin prefix, and its
 * values: `collections` lists the titles of the collections that use the item). Null when none.
 */
export function organizationErrorMessage(
  err: unknown
): { id: string; values: { collections: string } } | null {
  const issues = organizationIssues(err);
  const detailsCode = (err as any)?.response?.data?.error?.details?.code;
  const code =
    (typeof detailsCode === 'string' && (ORGANIZATION_CONFLICT_CODES as readonly string[]).includes(detailsCode)
      ? detailsCode
      : undefined) ?? issues.find((i) => (ORGANIZATION_CONFLICT_CODES as readonly string[]).includes(i.code))?.code;
  if (!code) return null;
  const collections = issues
    .filter((i) => i.code === 'IN_USE_BY_COLLECTIONS' && i.detail)
    .map((i) => i.detail as string);
  return {
    id: `ecommerce.organization.errors.${code}`,
    values: { collections: [...new Set(collections)].join(', ') },
  };
}

/** path -> code (the first issue per path); a code without a text becomes `invalid`. */
export function organizationFieldErrors(issues: OrganizationIssue[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    if (map[issue.path]) continue;
    map[issue.path] = KNOWN.has(issue.code) ? issue.code : 'invalid';
  }
  return map;
}
