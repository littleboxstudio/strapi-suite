import type { Core } from '@strapi/strapi';
import {
  ImageFieldOptions,
  SchemaLookup,
  buildPopulate,
  collectEntryIds,
  collectIds,
  isImageAttribute,
  validateData,
  walkImageValues,
} from './domain/values';
import { toMediaValue } from './domain/mediaValue';
import { hostValidationError } from './hostErrors';

const FILE_UID = 'plugin::upload.file';
/** Rows read per query while scanning for references. */
export const SCAN_BATCH_SIZE = 500;
/** A registry file never saved in an entry is an orphan once older than this. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Document actions that can add or drop field values. */
const WATCHED_ACTIONS = new Set([
  'create',
  'update',
  'publish',
  'delete',
  'discardDraft',
  'unpublish',
]);

export type FieldPath = {
  /** The content type or component that holds the attribute. */
  uid: string;
  kind: 'contentType' | 'component';
  attribute: string;
  options: ImageFieldOptions;
  required: boolean;
};

/** A Strapi rich text attribute that can embed a Media Library file. */
export type TextFieldPath = {
  uid: string;
  attribute: string;
  /** `blocks`: an image block holds the file (`image.id` / `image.url`); `richtext`: markdown. */
  type: 'blocks' | 'richtext';
};

export type FieldPaths = {
  fields: FieldPath[];
  /** Every `blocks` / `richtext` attribute across content types and components. */
  textFields: TextFieldPath[];
  /**
   * For each content type that reaches an `ltbimage` field (directly, through a component, a
   * repeatable component or a dynamic zone), the db `populate` loading those paths.
   */
  populate: Map<string, Record<string, any>>;
};

const lookupOf =
  (strapi: Core.Strapi): SchemaLookup =>
  (uid: string) =>
    ((strapi.contentTypes as any)[uid] ?? (strapi.components as any)[uid] ?? null) as any;

/** Every `ltbimage` attribute across content types and components, and how content types reach them. */
export function fieldPaths(strapi: Core.Strapi): FieldPaths {
  const fields: FieldPath[] = [];
  const textFields: TextFieldPath[] = [];
  const collect = (schemas: Record<string, any>, kind: FieldPath['kind']) => {
    for (const [uid, schema] of Object.entries(schemas ?? {})) {
      for (const [attribute, def] of Object.entries<any>(schema?.attributes ?? {})) {
        if (def?.type === 'blocks' || def?.type === 'richtext') {
          textFields.push({ uid, attribute, type: def.type });
        } else if (isImageAttribute(def)) {
          fields.push({
            uid,
            kind,
            attribute,
            options: def.options ?? {},
            required: !!def.required,
          });
        }
      }
    }
  };
  collect(strapi.contentTypes as any, 'contentType');
  collect(strapi.components as any, 'component');

  const populate = new Map<string, Record<string, any>>();
  if (fields.length > 0) {
    const lookup = lookupOf(strapi);
    for (const uid of Object.keys(strapi.contentTypes ?? {})) {
      const p = buildPopulate(uid, lookup);
      if (p !== null) populate.set(uid, p);
    }
  }
  return { fields, textFields, populate };
}

/**
 * Of the candidate ids, those still used: by any `ltbimage` value or rich text (`blocks` image block,
 * markdown mention of the file's url / a format url / its hash) of every row of every content type
 * and component table (so all locales, drafts and published versions), or by a Strapi media field.
 */
export async function referencedIds(
  strapi: Core.Strapi,
  candidates: Iterable<number>,
  paths: FieldPaths = fieldPaths(strapi)
): Promise<Set<number>> {
  const wanted = new Set(candidates);
  const found = new Set<number>();
  if (wanted.size === 0) return found;

  type Scan = { images: string[]; blocks: string[]; richtext: string[] };
  const byUid = new Map<string, Scan>();
  const scanOf = (uid: string): Scan => {
    let scan = byUid.get(uid);
    if (!scan) {
      scan = { images: [], blocks: [], richtext: [] };
      byUid.set(uid, scan);
    }
    return scan;
  };
  for (const f of paths.fields) scanOf(f.uid).images.push(f.attribute);
  for (const f of paths.textFields ?? []) scanOf(f.uid)[f.type].push(f.attribute);

  const needles =
    (paths.textFields ?? []).length > 0 ? await fileNeedles(strapi, [...wanted]) : new Map();
  const byUrl = new Map<string, number>();
  for (const [id, n] of needles) for (const url of n.urls) byUrl.set(url, id);

  for (const [uid, scan] of byUid) {
    const attributes = [...scan.images, ...scan.blocks, ...scan.richtext];
    let lastId = 0;
    for (;;) {
      const rows: any[] = await strapi.db.query(uid as any).findMany({
        select: ['id', ...attributes],
        where: { id: { $gt: lastId } },
        orderBy: { id: 'asc' },
        limit: SCAN_BATCH_SIZE,
      });
      for (const row of rows) {
        for (const attribute of scan.images) {
          for (const id of collectIds(row?.[attribute])) {
            if (wanted.has(id)) found.add(id);
          }
        }
        for (const attribute of scan.blocks) {
          visitImageBlocks(row?.[attribute], (image) => {
            const id = Number(image?.id);
            if (wanted.has(id)) found.add(id);
            const byLink = typeof image?.url === 'string' ? byUrl.get(image.url) : undefined;
            if (byLink !== undefined) found.add(byLink);
          });
        }
        for (const attribute of scan.richtext) {
          const text = row?.[attribute];
          if (typeof text !== 'string' || text === '') continue;
          for (const [id, n] of needles) {
            if (!found.has(id) && n.all.some((needle) => text.includes(needle))) found.add(id);
          }
        }
      }
      if (found.size === wanted.size) return found;
      if (rows.length < SCAN_BATCH_SIZE) break;
      lastId = rows[rows.length - 1].id;
    }
  }

  for (const id of await usedByMediaFields(
    strapi,
    [...wanted].filter((id) => !found.has(id))
  )) {
    found.add(id);
  }
  return found;
}

/** The strings by which rich text can point at each file: its url, every format url, its hash. */
async function fileNeedles(
  strapi: Core.Strapi,
  ids: number[]
): Promise<Map<number, { urls: string[]; all: string[] }>> {
  const out = new Map<number, { urls: string[]; all: string[] }>();
  for (let i = 0; i < ids.length; i += SCAN_BATCH_SIZE) {
    const files: any[] = await strapi.db.query(FILE_UID).findMany({
      where: { id: { $in: ids.slice(i, i + SCAN_BATCH_SIZE) } },
      select: ['id', 'url', 'hash', 'formats'],
    });
    for (const file of files) {
      const urls = [file.url, ...Object.values<any>(file.formats ?? {}).map((f) => f?.url)].filter(
        (u): u is string => typeof u === 'string' && u !== ''
      );
      const all = [...urls];
      if (typeof file.hash === 'string' && file.hash !== '') all.push(file.hash);
      out.set(file.id, { urls, all });
    }
  }
  return out;
}

/** Calls `visit` with the `image` of every image block of a `blocks` value, at any depth. */
function visitImageBlocks(value: unknown, visit: (image: any) => void): void {
  if (!Array.isArray(value)) return;
  for (const node of value) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'image' && node.image && typeof node.image === 'object') visit(node.image);
    visitImageBlocks(node.children, visit);
  }
}

export async function isReferenced(strapi: Core.Strapi, fileId: number): Promise<boolean> {
  return (await referencedIds(strapi, [fileId])).has(fileId);
}

/**
 * Ids linked to an entry through a regular Strapi media field (the file shows in the Media Library,
 * so it can be picked there too). When the link table cannot be resolved, every id counts as used.
 */
async function usedByMediaFields(strapi: Core.Strapi, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const joinTable: any = (strapi.db as any).metadata?.get?.(FILE_UID)?.attributes?.related
    ?.joinTable;
  const table = joinTable?.name;
  const column = joinTable?.joinColumn?.name;
  if (!table || !column) return ids;
  const rows: any[] = await strapi.db.getConnection(table).select(column).whereIn(column, ids);
  return [...new Set(rows.map((r) => Number(r[column])))];
}

/**
 * Deletes (through the upload service, so formats go too) every candidate file that this field
 * created and that nothing references any more, with its registry row. Never touches other files.
 */
export async function deleteUnreferenced(
  strapi: Core.Strapi,
  registryUid: string,
  candidates: Iterable<number>
): Promise<number[]> {
  const ids = [...new Set(candidates)];
  if (ids.length === 0) return [];
  const registered: any[] = await strapi.db
    .query(registryUid as any)
    .findMany({ where: { fileId: { $in: ids } }, select: ['id', 'fileId'] });
  if (registered.length === 0) return [];

  const used = await referencedIds(
    strapi,
    registered.map((r) => r.fileId)
  );
  const deleted: number[] = [];
  for (const row of registered) {
    if (used.has(row.fileId)) continue;
    try {
      await removeFile(strapi, registryUid, row);
      deleted.push(row.fileId);
    } catch (err) {
      strapi.log?.warn(
        `[image-field] could not delete file ${row.fileId}: ${err instanceof Error ? err.name : 'error'}`
      );
    }
  }
  return deleted;
}

async function removeFile(strapi: Core.Strapi, registryUid: string, row: any): Promise<void> {
  const file = await strapi.db.query(FILE_UID).findOne({ where: { id: row.fileId } });
  if (file) await strapi.plugin('upload').service('upload').remove(file);
  await strapi.db.query(registryUid as any).delete({ where: { id: row.id } });
}

/**
 * Registry rows older than 24 h whose file nothing references → file and row deleted; rows whose
 * file no longer exists → row deleted.
 */
export async function collectOrphans(
  strapi: Core.Strapi,
  registryUid: string,
  now: number = Date.now()
): Promise<number[]> {
  const cutoff = new Date(now - ORPHAN_AGE_MS);
  const paths = fieldPaths(strapi);
  const deleted: number[] = [];
  let lastId = 0;
  for (;;) {
    const rows: any[] = await strapi.db.query(registryUid as any).findMany({
      select: ['id', 'fileId', 'createdAt'],
      where: { id: { $gt: lastId }, createdAt: { $lt: cutoff } },
      orderBy: { id: 'asc' },
      limit: SCAN_BATCH_SIZE,
    });
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    // The date filter is repeated here so a store that ignores it can never delete a fresh file.
    const old = rows.filter((r) => new Date(r.createdAt).getTime() < cutoff.getTime());

    const files: any[] = await strapi.db
      .query(FILE_UID)
      .findMany({ where: { id: { $in: old.map((r) => r.fileId) } }, select: ['id'] });
    const existing = new Set(files.map((f) => f.id));
    const used = await referencedIds(
      strapi,
      old.filter((r) => existing.has(r.fileId)).map((r) => r.fileId),
      paths
    );
    for (const row of old) {
      if (existing.has(row.fileId) && used.has(row.fileId)) continue;
      try {
        if (existing.has(row.fileId)) {
          await removeFile(strapi, registryUid, row);
          deleted.push(row.fileId);
        } else {
          await strapi.db.query(registryUid as any).delete({ where: { id: row.id } });
        }
      } catch (err) {
        strapi.log?.warn(
          `[image-field] could not collect orphan ${row.fileId}: ${err instanceof Error ? err.name : 'error'}`
        );
      }
    }
    if (rows.length < SCAN_BATCH_SIZE) break;
  }
  return deleted;
}

/** Every version (locales, draft, published) of a document, with the image component paths loaded. */
async function snapshotIds(
  strapi: Core.Strapi,
  uid: string,
  documentId: string,
  populate: Record<string, any>,
  lookup: SchemaLookup
): Promise<{ rows: any[]; ids: Set<number> }> {
  const rows: any[] = await strapi.db
    .query(uid as any)
    .findMany({ where: { documentId }, populate });
  return { rows, ids: collectEntryIds(uid, rows, lookup) };
}

const requiresOnSave = (contentType: any, params: any): boolean =>
  !contentType?.options?.draftAndPublish || params?.status === 'published';

const localeMatches = (rowLocale: unknown, locale: unknown): boolean =>
  locale === undefined || locale === null || locale === '*' || rowLocale === locale;

/**
 * Replaces every incoming `ltbimage` value with the Media Library file it names (`toMediaValue`, order
 * kept), so a stored value never carries client-made data. An unknown id is a `ValidationError`.
 */
export async function resolveIncomingValues(
  strapi: Core.Strapi,
  uid: string,
  data: unknown,
  lookup: SchemaLookup
): Promise<void> {
  const ids = new Set<number>();
  walkImageValues(uid, data, lookup, (value) => collectIds(value).forEach((id) => ids.add(id)));
  if (ids.size === 0) return;

  const files = new Map<number, any>();
  const list = [...ids];
  for (let i = 0; i < list.length; i += SCAN_BATCH_SIZE) {
    const rows: any[] = await strapi.db
      .query(FILE_UID)
      .findMany({ where: { id: { $in: list.slice(i, i + SCAN_BATCH_SIZE) } } });
    for (const row of rows) files.set(row.id, row);
  }

  const resolve = (item: any, path: string) => {
    const file = files.get(Number(item?.id));
    if (!file) {
      const ValidationError = hostValidationError();
      throw new ValidationError(`${path}: image ${Number(item?.id)} does not exist`, {
        path: path.split('.'),
      });
    }
    return toMediaValue(file);
  };
  walkImageValues(uid, data, lookup, (value, _attribute, _options, path, set) => {
    if (Array.isArray(value)) set(value.map((item) => resolve(item, path)));
    else if (value !== null && value !== undefined) set(resolve(value, path));
  });
}

/**
 * Document service middleware: validates incoming `ltbimage` values (and replaces them with the
 * stored files) and, after an action that can drop values, deletes the field's files nothing uses
 * any more. Cleanup never fails nor delays the action: it runs after the response (or after the
 * surrounding transaction commits) and its failures are only logged (ids only).
 */
export function createImageFieldMiddleware(strapi: Core.Strapi, registryUid: () => string) {
  let paths: FieldPaths | null = null;
  const lookup = lookupOf(strapi);
  const warn = (action: string, err: unknown) =>
    strapi.log?.warn(
      `[image-field] cleanup after ${action} failed: ${err instanceof Error ? err.name : 'error'}`
    );

  return async (ctx: any, next: () => Promise<unknown>) => {
    if (!WATCHED_ACTIONS.has(ctx?.action)) return next();
    paths ??= fieldPaths(strapi);
    const populate = paths.populate.get(ctx.uid);
    if (!populate) return next();

    const params = ctx.params ?? {};
    const contentType = ctx.contentType ?? (strapi.contentTypes as any)[ctx.uid];
    if ((ctx.action === 'create' || ctx.action === 'update') && params.data) {
      validateData(ctx.uid, params.data, lookup, requiresOnSave(contentType, params));
      await resolveIncomingValues(strapi, ctx.uid, params.data, lookup);
    }

    const documentId = params.documentId;
    let before: { rows: any[]; ids: Set<number> } | null = null;
    if (documentId) {
      try {
        before = await snapshotIds(strapi, ctx.uid, documentId, populate, lookup);
      } catch (err) {
        // Without the "before" state nothing can be compared: only the cleanup is skipped.
        warn(ctx.action, err);
      }
      if (before && ctx.action === 'publish') {
        // Publishing makes the draft the public version: its required images must be set.
        for (const row of before.rows) {
          if (row.publishedAt == null && localeMatches(row.locale, params.locale)) {
            validateData(ctx.uid, row, lookup, true);
          }
        }
      }
    }

    const result = await next();
    if (!before || before.ids.size === 0) return result;

    const beforeIds = before.ids;
    const action = ctx.action;
    const run = async () => {
      try {
        const after = await snapshotIds(strapi, ctx.uid, documentId, populate, lookup);
        const removed = [...beforeIds].filter((id) => !after.ids.has(id));
        if (removed.length > 0) await deleteUnreferenced(strapi, registryUid(), removed);
      } catch (err) {
        warn(action, err);
      }
    };
    try {
      await scheduleCleanup(strapi, run);
    } catch (err) {
      warn(action, err);
    }
    return result;
  };
}

/**
 * Runs the work after the surrounding transaction commits (never on a rollback), or, outside a
 * transaction, after the current response (not awaited).
 */
async function scheduleCleanup(strapi: Core.Strapi, run: () => Promise<void>): Promise<void> {
  const db: any = strapi.db;
  if (typeof db.inTransaction === 'function' && db.inTransaction()) {
    await db.transaction(async ({ onCommit }: any) => {
      onCommit(() => {
        void run();
      });
    });
    return;
  }
  setImmediate(() => void run());
}
