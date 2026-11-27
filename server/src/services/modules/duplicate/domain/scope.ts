/**
 * Which contents a duplication covers and how they relate. Pure: the Strapi schemas come through a
 * `SchemaLookup` (`strapi.contentTypes[uid]` / `strapi.components[uid]` in the runner).
 */

export type SchemaLookup = {
  contentType(uid: string): any | undefined;
  component(uid: string): any | undefined;
};

export type ScopeEntry = { uid: string; kind: 'collectionType' | 'singleType'; draftAndPublish: boolean };

export type RelationRef = { path: string; targetUid: string; documentId: string };

/** Attributes Strapi manages itself: never read as content nor written. */
export const SYSTEM_FIELDS = new Set([
  'id',
  'documentId',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'localizations',
]);

const AUDIT_RELATIONS = new Set(['createdBy', 'updatedBy', 'localizations']);

const TO_MANY = new Set(['oneToMany', 'manyToMany', 'manyWay', 'morphToMany', 'morphMany']);

export function isLocalizedContentType(ct: any): boolean {
  return ct?.pluginOptions?.i18n?.localized === true;
}

export function isLocalizedApiType(uid: string, ct: any): boolean {
  return typeof uid === 'string' && uid.startsWith('api::') && isLocalizedContentType(ct);
}

/**
 * Whether a top-level attribute of a localized content type is localized, as Strapi i18n decides
 * (`getNonLocalizedAttributes`): the attribute's option, and relations and uids always. A not
 * localized attribute is shared by Strapi across locales, so the duplication never writes it.
 */
export function isLocalizedAttribute(attribute: any): boolean {
  return (
    attribute?.pluginOptions?.i18n?.localized === true ||
    attribute?.type === 'relation' ||
    attribute?.type === 'uid'
  );
}

/** A relation the duplication writes: has a target and is the owning side (not `mappedBy`). */
export function isWritableRelation(attribute: any): boolean {
  return (
    attribute?.type === 'relation' &&
    typeof attribute.target === 'string' &&
    !attribute.mappedBy &&
    !String(attribute.relation ?? '').startsWith('morph')
  );
}

export function isToManyRelation(attribute: any): boolean {
  return TO_MANY.has(attribute?.relation);
}

export function listScope(contentTypes: Record<string, any>): ScopeEntry[] {
  return Object.entries(contentTypes ?? {})
    .filter(([uid, ct]) => isLocalizedApiType(uid, ct))
    .map(([uid, ct]) => ({
      uid,
      kind: ct.kind === 'singleType' ? ('singleType' as const) : ('collectionType' as const),
      draftAndPublish: ct.options?.draftAndPublish === true,
    }))
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

function join(path: string, segment: string | number): string {
  return path ? `${path}.${segment}` : String(segment);
}

function relationIds(value: any): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => (typeof item === 'string' ? item : item?.documentId))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function walkRelations(
  attributes: Record<string, any>,
  data: any,
  lookup: SchemaLookup,
  basePath: string,
  topLevel: boolean,
  refs: RelationRef[]
): void {
  if (!attributes || !data || typeof data !== 'object') return;
  for (const [name, attribute] of Object.entries<any>(attributes)) {
    if (topLevel && (SYSTEM_FIELDS.has(name) || !isLocalizedAttribute(attribute))) continue;
    const path = join(basePath, name);
    const value = data[name];
    if (value == null) continue;

    if (attribute.type === 'relation') {
      if (AUDIT_RELATIONS.has(name) || !isWritableRelation(attribute)) continue;
      if (!isLocalizedContentType(lookup.contentType(attribute.target))) continue;
      for (const documentId of relationIds(value)) {
        refs.push({ path, targetUid: attribute.target, documentId });
      }
      continue;
    }

    if (attribute.type === 'component') {
      const schema = lookup.component(attribute.component);
      if (!schema) continue;
      if (attribute.repeatable) {
        if (!Array.isArray(value)) continue;
        value.forEach((entry, index) =>
          walkRelations(schema.attributes, entry, lookup, join(path, index), false, refs)
        );
      } else {
        walkRelations(schema.attributes, value, lookup, path, false, refs);
      }
      continue;
    }

    if (attribute.type === 'dynamiczone') {
      if (!Array.isArray(value)) continue;
      value.forEach((entry, index) => {
        const schema = entry?.__component ? lookup.component(entry.__component) : undefined;
        if (!schema) return;
        walkRelations(schema.attributes, entry, lookup, join(path, index), false, refs);
      });
    }
  }
}

/**
 * The relations of a populated document version to localized content types, wherever they are
 * (top-level localized attributes, nested components, dynamic zones). Paths name the relation
 * attribute (`author`, `seo.page`, `blocks.0.cta.page`), one ref per related document. Inverse sides
 * (`mappedBy`) are not returned: the owning side carries the link.
 */
export function collectLocalizedRelations(uid: string, doc: any, lookup: SchemaLookup): RelationRef[] {
  const refs: RelationRef[] = [];
  const ct = lookup.contentType(uid);
  if (!ct) return refs;
  walkRelations(ct.attributes, doc, lookup, '', true, refs);
  return refs;
}

function populateOf(attributes: Record<string, any>, lookup: SchemaLookup, topLevel: boolean): Record<string, any> {
  const populate: Record<string, any> = {};
  for (const [name, attribute] of Object.entries<any>(attributes ?? {})) {
    if (topLevel && AUDIT_RELATIONS.has(name)) continue;
    switch (attribute?.type) {
      case 'media':
        populate[name] = true;
        break;
      case 'relation': {
        if (AUDIT_RELATIONS.has(name) || !isWritableRelation(attribute)) break;
        populate[name] = {
          fields: isLocalizedContentType(lookup.contentType(attribute.target))
            ? ['documentId', 'locale']
            : ['documentId'],
        };
        break;
      }
      case 'component': {
        const schema = lookup.component(attribute.component);
        if (!schema) break;
        const nested = populateOf(schema.attributes, lookup, false);
        populate[name] = Object.keys(nested).length ? { populate: nested } : true;
        break;
      }
      case 'dynamiczone': {
        const on: Record<string, any> = {};
        for (const componentUid of attribute.components ?? []) {
          const schema = lookup.component(componentUid);
          if (!schema) continue;
          const nested = populateOf(schema.attributes, lookup, false);
          on[componentUid] = Object.keys(nested).length ? { populate: nested } : true;
        }
        populate[name] = { on };
        break;
      }
      default:
        break;
    }
  }
  return populate;
}

/**
 * The Document Service `populate` that reads everything a duplication copies: components nested,
 * dynamic zones by component (`on`), relations with their documentId (and locale for localized
 * targets), media. Audit relations and inverse relation sides are not populated.
 */
export function deepPopulate(uid: string, lookup: SchemaLookup): Record<string, any> {
  const ct = lookup.contentType(uid);
  if (!ct) return {};
  return populateOf(ct.attributes, lookup, true);
}
