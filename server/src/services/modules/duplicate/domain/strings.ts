/**
 * The translatable strings of a document, for the duplication. Server port of the Translate with AI
 * rules (admin/src/core/utils/documentFields.ts and translateDocument.ts), working on the source
 * version alone: the target is built from it, so every path of the source exists in the target data.
 * Kept in step with the admin by hand (the admin file is not shared with the server build).
 */
import { isLocalizedAttribute, SYSTEM_FIELDS, type SchemaLookup } from './scope';

const SLUG_CUSTOM_FIELD = 'plugin::littlebox-strapi-suite.ltbslug';
const TEXT_TYPES = ['string', 'text', 'richtext'];
const URL_PATTERN = /^(https?:\/\/|\/|mailto:|tel:)\S*$/i;

export type StringField = { path: string; value: string; kind: 'text' | 'slug' };

function isFilled(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTranslatableText(value: any): value is string {
  return isFilled(value) && !URL_PATTERN.test(value.trim());
}

/** Inside components (no i18n option of their own) the admin rule: localized unless said otherwise. */
function isNestedLocalized(attribute: any): boolean {
  return attribute?.pluginOptions?.i18n?.localized !== false;
}

function isSlug(attribute: any): boolean {
  return attribute?.customField === SLUG_CUSTOM_FIELD || attribute?.type === 'uid';
}

function join(path: string, segment: string | number): string {
  return path ? `${path}.${segment}` : String(segment);
}

function collectBlocks(nodes: any, path: string, fields: StringField[]): void {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((node: any, index: number) => {
    if (!node) return;
    if (isTranslatableText(node.text)) {
      fields.push({ path: join(path, `${index}.text`), value: node.text, kind: 'text' });
    }
    collectBlocks(node.children, join(path, `${index}.children`), fields);
  });
}

function collect(
  attributes: Record<string, any>,
  data: any,
  lookup: SchemaLookup,
  basePath: string,
  topLevel: boolean,
  fields: StringField[]
): void {
  if (!attributes || !data || typeof data !== 'object') return;
  for (const [name, attribute] of Object.entries<any>(attributes)) {
    if (topLevel) {
      if (SYSTEM_FIELDS.has(name) || !isLocalizedAttribute(attribute)) continue;
    } else if (!isNestedLocalized(attribute)) {
      continue;
    }
    const path = join(basePath, name);
    const value = data[name];

    if (isSlug(attribute)) {
      if (isFilled(value)) fields.push({ path, value, kind: 'slug' });
      continue;
    }

    if (TEXT_TYPES.includes(attribute.type)) {
      if (isTranslatableText(value)) fields.push({ path, value, kind: 'text' });
      continue;
    }

    if (attribute.type === 'blocks') {
      collectBlocks(value, path, fields);
      continue;
    }

    if (attribute.type === 'component') {
      const schema = lookup.component(attribute.component);
      if (!schema) continue;
      if (attribute.repeatable) {
        if (!Array.isArray(value)) continue;
        value.forEach((entry: any, index: number) =>
          collect(schema.attributes, entry, lookup, join(path, index), false, fields)
        );
        continue;
      }
      collect(schema.attributes, value, lookup, path, false, fields);
      continue;
    }

    if (attribute.type === 'dynamiczone') {
      if (!Array.isArray(value)) continue;
      value.forEach((entry: any, index: number) => {
        const schema = entry?.__component ? lookup.component(entry.__component) : undefined;
        if (!schema) return;
        collect(schema.attributes, entry, lookup, join(path, index), false, fields);
      });
    }
  }
}

/**
 * The translatable leaves of a document version: localized text / rich text (URLs and blanks
 * skipped), text nodes of blocks (`field.0.children.1.text`), the slug custom field and uids as
 * `slug`, inside components and dynamic zones too.
 */
export function collectStrings(uid: string, data: any, lookup: SchemaLookup): StringField[] {
  const fields: StringField[] = [];
  const ct = lookup.contentType(uid);
  if (!ct) return fields;
  collect(ct.attributes, data, lookup, '', true, fields);
  return fields;
}

/** The strings for `translateStrings`, keyed by index; a slug is sent as words. */
export function toAiStrings(fields: StringField[]): Record<string, string> {
  const strings: Record<string, string> = {};
  fields.forEach((field, index) => {
    strings[String(index)] = field.kind === 'slug' ? field.value.replace(/-/g, ' ') : field.value;
  });
  return strings;
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

/** Writes `value` at `path` when every container on the way exists (only the leaf may be new). */
function setAt(data: any, path: string, value: string): void {
  const segments = path.split('.');
  let node = data;
  for (const segment of segments.slice(0, -1)) {
    node = node?.[segment];
    if (!node || typeof node !== 'object') return;
  }
  if (!node || typeof node !== 'object') return;
  node[segments[segments.length - 1]] = value;
}

/**
 * The data with the translations written at the fields' paths (the input is not changed). A slug
 * translation is converted to a slug. A missing or blank translation (or a slug that converts to
 * nothing) keeps the source value and counts as failed.
 */
export function applyStrings(
  data: any,
  fields: StringField[],
  translations: Record<string, string>
): { data: any; failed: number } {
  const out = clone(data);
  let failed = 0;
  fields.forEach((field, index) => {
    const translation = translations?.[String(index)];
    let value: string | null = null;
    if (typeof translation === 'string' && translation.trim()) {
      value = field.kind === 'slug' ? convertToSlug(translation) || null : translation;
    }
    if (value === null) {
      failed += 1;
      value = field.value;
    }
    setAt(out, field.path, value);
  });
  return { data: out, failed };
}

/** Copy of admin/src/core/utils/convertToSlug.ts (default behaviour, finished slug). */
export function convertToSlug(text: string, maxLength: number = 100): string {
  if (!text) return '';
  let slug = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  if (slug.length > maxLength) slug = slug.substring(0, maxLength).replace(/-+$/g, '');
  return slug;
}
