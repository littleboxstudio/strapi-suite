/**
 * Helpers on the dotted paths the duplication uses (`author`, `seo.page`, `blocks.0.cta.page`).
 */
import type { SchemaLookup } from './scope';

/** The pseudo path of the page-attributes parent (not an attribute of the content). */
export const PARENT_PATH = '__parent';

const isIndex = (segment: string) => /^\d+$/.test(segment);

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: any = {};
    for (const [key, item] of Object.entries(value)) out[key] = clone(item);
    return out;
  }
  return value;
}

/**
 * The schema attribute a path names in a document version (`doc` tells which component a dynamic
 * zone entry holds). Undefined when the path names nothing.
 */
export function attributeAt(uid: string, path: string, lookup: SchemaLookup, doc: any): any | undefined {
  let attributes = lookup.contentType(uid)?.attributes;
  let value = doc;
  let attribute: any;
  const segments = path.split('.');
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (isIndex(segment)) {
      value = Array.isArray(value) ? value[Number(segment)] : undefined;
      if (attribute?.type === 'dynamiczone') {
        attributes = value?.__component ? lookup.component(value.__component)?.attributes : undefined;
      }
      continue;
    }
    attribute = attributes?.[segment];
    if (!attribute) return undefined;
    value = value?.[segment];
    if (i === segments.length - 1) return attribute;
    if (attribute.type === 'component') attributes = lookup.component(attribute.component)?.attributes;
    else if (attribute.type === 'dynamiczone') attributes = undefined;
    else return undefined;
  }
  return undefined;
}

/**
 * A copy of a populated version without the given related documents: a to-one relation becomes
 * `null`, a to-many relation loses those entries. Paths that do not exist are ignored.
 */
export function dropRelations(source: any, drops: { path: string; documentId: string }[]): any {
  if (!drops.length) return source;
  const out = clone(source);
  for (const { path, documentId } of drops) {
    const segments = path.split('.');
    let node = out;
    for (const segment of segments.slice(0, -1)) {
      node = node?.[segment];
      if (!node || typeof node !== 'object') break;
    }
    if (!node || typeof node !== 'object') continue;
    const leaf = segments[segments.length - 1];
    const value = node[leaf];
    const idOf = (item: any) => (typeof item === 'string' ? item : item?.documentId);
    if (Array.isArray(value)) node[leaf] = value.filter((item) => idOf(item) !== documentId);
    else if (value && idOf(value) === documentId) node[leaf] = null;
  }
  return out;
}

/** The top-level attributes holding the paths (the parent pseudo path is not one). */
export function topLevelKeys(paths: string[]): string[] {
  const keys: string[] = [];
  for (const path of paths) {
    if (path === PARENT_PATH) continue;
    const key = path.split('.')[0];
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
