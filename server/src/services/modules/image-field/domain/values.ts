import { hostValidationError } from '../hostErrors';

/** The `customField` key Strapi keeps on an `ltbimage` attribute (its `type` becomes `json`). */
export const IMAGE_FIELD_UID = 'plugin::littlebox-strapi-suite.ltbimage';

export type ImageFieldOptions = {
  mode?: 'single' | 'gallery' | string;
  maxImages?: number | string | null;
  [key: string]: unknown;
};

/** Looks up a content type or component schema by uid. */
export type SchemaLookup = (uid: string) => { attributes?: Record<string, any> } | undefined | null;

export const isImageAttribute = (attribute: any): boolean =>
  !!attribute && attribute.customField === IMAGE_FIELD_UID;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const toFileId = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

/** Media Library file ids of a stored value (an object, an array of objects or null). */
export function collectIds(value: unknown): number[] {
  const items = Array.isArray(value) ? value : [value];
  const ids: number[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const id = toFileId(item.id);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const maxImagesOf = (options: ImageFieldOptions | undefined): number | null => {
  const raw = options?.maxImages;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

const isValidItem = (item: unknown): boolean =>
  isPlainObject(item) && typeof item.id === 'number' && Number.isInteger(item.id) && item.id > 0;

/**
 * Throws a `ValidationError` when the value does not fit the field: single → an object with a numeric
 * `id` or null; gallery → an array of such objects, at most `maxImages`. With `enforceRequired`, a
 * required field must hold an image (gallery: a non-empty array).
 */
export function validateValue(
  value: unknown,
  options: ImageFieldOptions | undefined,
  rules: { required?: boolean; enforceRequired?: boolean; path?: string } = {}
): void {
  const path = rules.path ?? 'value';
  const fail = (message: string) => {
    const ValidationError = hostValidationError();
    throw new ValidationError(`${path}: ${message}`, { path: path.split('.') });
  };
  const gallery = options?.mode === 'gallery';
  const required = !!rules.required && !!rules.enforceRequired;

  if (gallery) {
    if (value === null || value === undefined) {
      if (required) fail('at least one image is required');
      return;
    }
    if (!Array.isArray(value)) fail('must be an array of images');
    const list = value as unknown[];
    if (!list.every(isValidItem)) fail('every image must be an object with a numeric id');
    const max = maxImagesOf(options);
    if (max !== null && list.length > max) fail(`at most ${max} images are allowed`);
    if (required && list.length === 0) fail('at least one image is required');
    return;
  }

  if (value === null || value === undefined) {
    if (required) fail('an image is required');
    return;
  }
  if (!isValidItem(value)) fail('must be an image object with a numeric id or null');
}

/**
 * True when the schema (content type or component) holds an `ltbimage` field directly or through
 * a component / repeatable component / dynamic zone, at any depth.
 */
export function reachesImageField(
  uid: string,
  lookup: SchemaLookup,
  seen: Set<string> = new Set()
): boolean {
  return buildPopulate(uid, lookup, seen) !== null;
}

/**
 * The db-query `populate` that loads every component path leading to an `ltbimage` field of the
 * schema: `{}` when the fields are all direct, `null` when the schema reaches none.
 */
export function buildPopulate(
  uid: string,
  lookup: SchemaLookup,
  seen: Set<string> = new Set()
): Record<string, any> | null {
  if (seen.has(uid)) return null;
  const schema = lookup(uid);
  if (!schema?.attributes) return null;
  const nextSeen = new Set(seen).add(uid);
  let direct = false;
  const populate: Record<string, any> = {};
  for (const [name, attribute] of Object.entries(schema.attributes)) {
    if (isImageAttribute(attribute)) {
      direct = true;
    } else if (attribute?.type === 'component' && attribute.component) {
      const nested = buildPopulate(attribute.component, lookup, nextSeen);
      if (nested !== null) populate[name] = { populate: nested };
    } else if (attribute?.type === 'dynamiczone' && Array.isArray(attribute.components)) {
      const on: Record<string, any> = {};
      for (const componentUid of attribute.components) {
        const nested = buildPopulate(componentUid, lookup, nextSeen);
        if (nested !== null) on[componentUid] = { populate: nested };
      }
      if (Object.keys(on).length > 0) populate[name] = { on };
    }
  }
  return direct || Object.keys(populate).length > 0 ? populate : null;
}

type Visitor = (
  value: unknown,
  attribute: any,
  options: ImageFieldOptions | undefined,
  path: string,
  /** Replaces the value in the walked object. */
  set: (next: unknown) => void
) => void;

/**
 * Calls `visit` for every `ltbimage` value present in a row or in incoming data of the schema,
 * following components (single / repeatable) and dynamic zone entries (by `__component`).
 * Attributes absent from the object are skipped (partial updates).
 */
export function walkImageValues(
  uid: string,
  entry: unknown,
  lookup: SchemaLookup,
  visit: Visitor,
  path = ''
): void {
  if (!isPlainObject(entry)) return;
  const schema = lookup(uid);
  if (!schema?.attributes) return;
  for (const [name, attribute] of Object.entries(schema.attributes)) {
    if (!(name in entry)) continue;
    const value = entry[name];
    const at = path ? `${path}.${name}` : name;
    if (isImageAttribute(attribute)) {
      visit(value, attribute, attribute.options, at, (next) => {
        entry[name] = next;
      });
    } else if (attribute?.type === 'component' && attribute.component) {
      const items = Array.isArray(value) ? value : [value];
      items.forEach((item, i) =>
        walkImageValues(
          attribute.component,
          item,
          lookup,
          visit,
          Array.isArray(value) ? `${at}.${i}` : at
        )
      );
    } else if (attribute?.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((item, i) => {
        if (!isPlainObject(item) || typeof item.__component !== 'string') return;
        if (Array.isArray(attribute.components) && !attribute.components.includes(item.__component))
          return;
        walkImageValues(item.__component, item, lookup, visit, `${at}.${i}`);
      });
    }
  }
}

/** Every file id held by the `ltbimage` fields of the given rows (all versions of a document). */
export function collectEntryIds(uid: string, rows: unknown[], lookup: SchemaLookup): Set<number> {
  const ids = new Set<number>();
  for (const row of rows) {
    walkImageValues(uid, row, lookup, (value) => collectIds(value).forEach((id) => ids.add(id)));
  }
  return ids;
}

/** Validates every `ltbimage` value of incoming data (or of a stored row). */
export function validateData(
  uid: string,
  data: unknown,
  lookup: SchemaLookup,
  enforceRequired: boolean
): void {
  walkImageValues(uid, data, lookup, (value, attribute, options, path) =>
    validateValue(value, options, { required: !!attribute?.required, enforceRequired, path })
  );
}
