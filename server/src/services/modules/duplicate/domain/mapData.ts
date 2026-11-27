/**
 * The Document Service `data` of a target-locale version, built from a populated source version.
 */
import {
  isLocalizedAttribute,
  isToManyRelation,
  isWritableRelation,
  SYSTEM_FIELDS,
  type SchemaLookup,
} from './scope';

const SLUG_CUSTOM_FIELD = 'plugin::littlebox-strapi-suite.ltbslug';

type Options = { deferred?: string[]; replace?: boolean };
type Context = { lookup: SchemaLookup; deferred: Set<string>; replace: boolean };

function join(path: string, segment: string | number): string {
  return path ? `${path}.${segment}` : String(segment);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: any = {};
    for (const [key, item] of Object.entries(value)) out[key] = clone(item);
    return out;
  }
  return value;
}

function isEmpty(value: any): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Whether the attribute holds a list (written empty as `[]`, else `null`). */
function isList(attribute: any): boolean {
  if (attribute?.type === 'relation') return isToManyRelation(attribute);
  if (attribute?.type === 'media') return attribute.multiple === true;
  if (attribute?.type === 'component') return attribute.repeatable === true;
  return attribute?.type === 'dynamiczone';
}

const emptyOf = (attribute: any) => (isList(attribute) ? [] : null);

function relationIds(value: any): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => (typeof item === 'string' ? item : item?.documentId))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function mediaIds(value: any): (number | string)[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => (typeof item === 'number' || typeof item === 'string' ? item : item?.id))
    .filter((id) => id !== undefined && id !== null);
}

/** `undefined` means: do not write this attribute. */
function mapAttribute(attribute: any, value: any, path: string, ctx: Context): any {
  switch (attribute?.type) {
    case 'relation': {
      if (!isWritableRelation(attribute)) return undefined;
      if (ctx.deferred.has(path)) return emptyOf(attribute);
      const ids = relationIds(value);
      return isToManyRelation(attribute) ? ids : (ids[0] ?? null);
    }
    case 'media': {
      const ids = mediaIds(value);
      return attribute.multiple ? ids : (ids[0] ?? null);
    }
    case 'component': {
      const schema = ctx.lookup.component(attribute.component);
      if (!schema) return undefined;
      if (attribute.repeatable) {
        if (!Array.isArray(value)) return [];
        return value.map((entry, index) => mapComponent(schema.attributes, entry, join(path, index), ctx));
      }
      return value ? mapComponent(schema.attributes, value, path, ctx) : null;
    }
    case 'dynamiczone': {
      if (!Array.isArray(value)) return [];
      return value
        .filter((entry) => entry && typeof entry.__component === 'string')
        .map((entry, index) => {
          const schema = ctx.lookup.component(entry.__component);
          const rest = schema
            ? mapComponent(schema.attributes, entry, join(path, index), ctx)
            : (({ id, ...others }) => clone(others))(entry);
          return { __component: entry.__component, ...rest };
        });
    }
    default:
      return clone(value);
  }
}

/** A component value without its id; every attribute present is written (components are replaced whole). */
function mapComponent(attributes: Record<string, any>, value: any, path: string, ctx: Context): any {
  const out: Record<string, any> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [name, attribute] of Object.entries<any>(attributes ?? {})) {
    const attrPath = join(path, name);
    const present = Object.prototype.hasOwnProperty.call(value, name);
    if (!present && !ctx.deferred.has(attrPath)) {
      if (ctx.replace) {
        if (attribute?.type === 'relation' && !isWritableRelation(attribute)) continue;
        out[name] = emptyOf(attribute);
      }
      continue;
    }
    const mapped = mapAttribute(attribute, value[name], attrPath, ctx);
    if (mapped !== undefined) out[name] = mapped;
  }
  return out;
}

/**
 * Builds the Document Service `data` for the target locale from a populated source version:
 * only localized attributes (Strapi i18n rule); drops the system fields; components and dynamic zone
 * entries without `id` (DZ keep `__component`); media as ids (one id or an array); relations as
 * documentIds (one or an array; Strapi links the target-locale version of a localized target), the
 * `deferred` paths empty (`null` / `[]`); inverse relation sides (`mappedBy`) are not written.
 * Attributes empty in the source are left out, unless `replace`: then they are written as `null` /
 * `[]` so the target becomes a true copy. The slug custom field is not written (the slug goes
 * through `ltb_slug`); the image field (json) is copied as is.
 */
export function mapData(uid: string, source: any, lookup: SchemaLookup, opts: Options): any {
  const ct = lookup.contentType(uid);
  const data: Record<string, any> = {};
  if (!ct || !source) return data;
  const ctx: Context = { lookup, deferred: new Set(opts?.deferred ?? []), replace: opts?.replace === true };

  for (const [name, attribute] of Object.entries<any>(ct.attributes ?? {})) {
    if (SYSTEM_FIELDS.has(name) || !isLocalizedAttribute(attribute)) continue;
    if (attribute?.customField === SLUG_CUSTOM_FIELD) continue;
    if (attribute?.type === 'relation' && !isWritableRelation(attribute)) continue;

    const value = source[name];
    if (isEmpty(value) && !ctx.deferred.has(name)) {
      if (ctx.replace) data[name] = emptyOf(attribute);
      continue;
    }
    const mapped = mapAttribute(attribute, value, name, ctx);
    if (mapped !== undefined) data[name] = mapped;
  }
  return data;
}

/** The attribute holding the Littlebox slug custom field, or null. */
export function slugFieldOf(uid: string, lookup: SchemaLookup): string | null {
  const attributes = lookup.contentType(uid)?.attributes ?? {};
  for (const [name, attribute] of Object.entries<any>(attributes)) {
    if (attribute?.customField === SLUG_CUSTOM_FIELD) return name;
  }
  return null;
}
