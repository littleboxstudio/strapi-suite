const SLUG_CUSTOM_FIELD = 'plugin::littlebox-strapi-suite.ltbslug';
const TEXT_TYPES = ['string', 'text', 'richtext'];
const URL_PATTERN = /^(https?:\/\/|\/|mailto:|tel:)\S*$/i;

export type FieldKind = 'text' | 'slug';

export interface TranslatableField {
  path: string;
  value: string;
  current: string;
  kind: FieldKind;
  /** The most characters the field accepts (text fields with a limit only). */
  maxLength?: number;
}

/** Strapi stores a `string` attribute in a varchar(255) column when it sets no maxLength. */
const STRING_COLUMN_LENGTH = 255;

/**
 * The most characters a text attribute accepts: its `maxLength`, else 255 for a `string`.
 * Same rule as server/src/utils/fieldMaxLength.ts.
 */
export function fieldMaxLength(attribute: any): number | undefined {
  const max = attribute?.maxLength;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) return Math.floor(max);
  return attribute?.type === 'string' ? STRING_COLUMN_LENGTH : undefined;
}

type Attributes = Record<string, any>;
type Components = Record<string, any>;

function isFilled(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTranslatableText(value: any): value is string {
  return isFilled(value) && !URL_PATTERN.test(value.trim());
}

function isLocalized(attribute: any): boolean {
  return attribute?.pluginOptions?.i18n?.localized !== false;
}

function isSlug(attribute: any): boolean {
  return attribute?.customField === SLUG_CUSTOM_FIELD || attribute?.type === 'uid';
}

function join(path: string, segment: string | number): string {
  return path ? `${path}.${segment}` : String(segment);
}

function collectBlocks(nodes: any, source: any, path: string, fields: TranslatableField[]): void {
  if (!Array.isArray(nodes) || !Array.isArray(source)) return;
  nodes.forEach((node: any, index: number) => {
    const sourceNode = source[index];
    if (!node || !sourceNode) return;
    if (isTranslatableText(sourceNode.text) && typeof node.text === 'string') {
      fields.push({
        path: join(path, `${index}.text`),
        value: sourceNode.text,
        current: node.text,
        kind: 'text',
      });
    }
    collectBlocks(node.children, sourceNode.children, join(path, `${index}.children`), fields);
  });
}

/**
 * Walks the schema over the values of the document being edited and, for every
 * translatable leaf, pairs it with the text found at the same path in the source
 * document. The walk is driven by the target so that every path produced already
 * exists in the open form, and dynamic zone entries are only paired when both
 * sides hold the same component.
 */
export function collectTranslatableFields(
  attributes: Attributes,
  components: Components,
  target: any,
  source: any,
  basePath: string = ''
): TranslatableField[] {
  const fields: TranslatableField[] = [];
  if (!attributes || !target || !source) return fields;

  for (const [name, attribute] of Object.entries<any>(attributes)) {
    if (!isLocalized(attribute)) continue;
    const path = join(basePath, name);
    const targetValue = target[name];
    const sourceValue = source[name];

    if (isSlug(attribute)) {
      if (isFilled(sourceValue) && typeof targetValue === 'string') {
        fields.push({ path, value: sourceValue, current: targetValue, kind: 'slug' });
      }
      continue;
    }

    if (TEXT_TYPES.includes(attribute.type)) {
      if (isTranslatableText(sourceValue) && typeof targetValue === 'string') {
        const maxLength = fieldMaxLength(attribute);
        fields.push({
          path,
          value: sourceValue,
          current: targetValue,
          kind: 'text',
          ...(maxLength ? { maxLength } : {}),
        });
      }
      continue;
    }

    if (attribute.type === 'blocks') {
      collectBlocks(targetValue, sourceValue, path, fields);
      continue;
    }

    if (attribute.type === 'component') {
      const schema = components[attribute.component];
      if (!schema) continue;
      if (attribute.repeatable) {
        if (!Array.isArray(targetValue) || !Array.isArray(sourceValue)) continue;
        targetValue.forEach((entry: any, index: number) => {
          fields.push(
            ...collectTranslatableFields(
              schema.attributes,
              components,
              entry,
              sourceValue[index],
              join(path, index)
            )
          );
        });
        continue;
      }
      fields.push(
        ...collectTranslatableFields(schema.attributes, components, targetValue, sourceValue, path)
      );
      continue;
    }

    if (attribute.type === 'dynamiczone') {
      if (!Array.isArray(targetValue) || !Array.isArray(sourceValue)) continue;
      targetValue.forEach((entry: any, index: number) => {
        const sourceEntry = sourceValue[index];
        if (!entry || !sourceEntry) return;
        if (entry.__component !== sourceEntry.__component) return;
        const schema = components[entry.__component];
        if (!schema) return;
        fields.push(
          ...collectTranslatableFields(
            schema.attributes,
            components,
            entry,
            sourceEntry,
            join(path, index)
          )
        );
      });
    }
  }

  return fields;
}

/**
 * Counts the translatable leaves of the source document on its own, so the
 * caller can tell how many of them found no counterpart in the open document.
 */
export function countTranslatableFields(
  attributes: Attributes,
  components: Components,
  source: any
): number {
  return collectTranslatableFields(attributes, components, source, source).length;
}
