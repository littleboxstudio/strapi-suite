import { vi } from 'vitest';
import type { SchemaLookup } from '../../../../server/src/services/modules/duplicate/domain/scope';

type Status = 'draft' | 'published';
type Entry = { uid: string; documentId: string; locale: string; status: Status; data: any };

const clone = (v: any) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * A hand-made stand-in for `strapi.documents(uid)` (Strapi 5 Document Service), enough for the
 * duplication runner:
 * - `update({ documentId, locale, data })` creates the locale's draft when missing, else merges the
 *   top-level keys into the draft (components replaced whole); it records the call (with the
 *   virtual `ltb_*` fields) and stores the data without them;
 * - like Strapi, a relation to a localized type must point at a document whose version exists in
 *   the written locale (draft), else it throws `Document with id "x", locale "y" not found`;
 * - `publish` copies the draft to the published version; `unpublish` removes the published one;
 * - `findMany` / `findOne` / `count` read the stored versions; without a `documentId` sort, a page after
 *   the first reads the rows in reverse order (SQL gives no order without ORDER BY).
 * `failOn(uid, documentId)` makes every write of that document throw.
 */
export function createFakeDocuments(lookup: SchemaLookup) {
  const entries: Entry[] = [];
  const calls: { uid: string; action: string; params: any }[] = [];
  const failing = new Set<string>();

  const find = (uid: string, documentId: string, locale: string, status: Status) =>
    entries.find((e) => e.uid === uid && e.documentId === documentId && e.locale === locale && e.status === status);

  const isDp = (uid: string) => lookup.contentType(uid)?.options?.draftAndPublish === true;
  const isLocalized = (uid: string) => lookup.contentType(uid)?.pluginOptions?.i18n?.localized === true;

  const checkRelations = (attributes: Record<string, any>, data: any, locale: string, path: string) => {
    if (!data || typeof data !== 'object') return;
    for (const [name, attribute] of Object.entries<any>(attributes ?? {})) {
      const value = data[name];
      if (value === undefined || value === null) continue;
      const at = path ? `${path}.${name}` : name;
      if (attribute.type === 'relation' && isLocalized(attribute.target)) {
        for (const id of Array.isArray(value) ? value : [value]) {
          const documentId = typeof id === 'string' ? id : id?.documentId;
          if (!find(attribute.target, documentId, locale, 'draft')) {
            throw new Error(`Document with id "${documentId}", locale "${locale}" not found (${at})`);
          }
        }
      } else if (attribute.type === 'component') {
        const schema = lookup.component(attribute.component);
        const list = attribute.repeatable ? value : [value];
        list.forEach((entry: any, i: number) =>
          checkRelations(schema?.attributes, entry, locale, attribute.repeatable ? `${at}.${i}` : at)
        );
      } else if (attribute.type === 'dynamiczone') {
        value.forEach((entry: any, i: number) =>
          checkRelations(lookup.component(entry.__component)?.attributes, entry, locale, `${at}.${i}`)
        );
      }
    }
  };

  const strip = (data: any) =>
    Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !k.startsWith('ltb_')));

  const documents = (uid: string) => {
    const dp = isDp(uid);
    const statusOf = (s?: Status): Status => (dp ? (s ?? 'draft') : 'draft');
    const api: any = {
      findMany: vi.fn(async ({ locale, status, limit, start = 0, sort }: any = {}) => {
        calls.push({ uid, action: 'findMany', params: { locale, status } });
        let list = entries
          .filter((e) => e.uid === uid && e.locale === locale && e.status === statusOf(status))
          .map((e) => ({ documentId: e.documentId, locale: e.locale, ...clone(e.data) }));
        const bySort = (Array.isArray(sort) ? sort : sort ? [sort] : []).find((s: any) => s?.documentId);
        if (bySort) {
          const dir = bySort.documentId === 'desc' ? -1 : 1;
          list.sort((x, y) => (x.documentId < y.documentId ? -dir : x.documentId > y.documentId ? dir : 0));
        } else if (start > 0) {
          // Like SQL without ORDER BY, the row order is not guaranteed from one page to the next.
          list = list.reverse();
        }
        return limit ? list.slice(start, start + limit) : list;
      }),
      findOne: vi.fn(async ({ documentId, locale, status }: any) => {
        const e = find(uid, documentId, locale, statusOf(status));
        return e ? { documentId, locale, ...clone(e.data) } : null;
      }),
      count: vi.fn(async ({ locale }: any) => entries.filter((e) => e.uid === uid && e.locale === locale && e.status === 'draft').length),
      update: vi.fn(async ({ documentId, locale, data }: any) => {
        calls.push({ uid, action: 'update', params: clone({ documentId, locale, data }) });
        if (failing.has(`${uid}#${documentId}`)) throw new Error('Write refused');
        if (!entries.some((e) => e.uid === uid && e.documentId === documentId)) throw new Error('No such document');
        checkRelations(lookup.contentType(uid)?.attributes, data, locale, '');
        const current = find(uid, documentId, locale, 'draft');
        if (current) Object.assign(current.data, clone(strip(data)));
        else entries.push({ uid, documentId, locale, status: 'draft', data: clone(strip(data)) });
        return { documentId, locale };
      }),
    };
    if (dp) {
      api.publish = vi.fn(async ({ documentId, locale }: any) => {
        calls.push({ uid, action: 'publish', params: { documentId, locale } });
        const draft = find(uid, documentId, locale, 'draft');
        if (!draft) throw new Error('Nothing to publish');
        const old = find(uid, documentId, locale, 'published');
        if (old) entries.splice(entries.indexOf(old), 1);
        entries.push({ ...draft, status: 'published', data: clone(draft.data) });
        return { documentId, entries: [] };
      });
      api.unpublish = vi.fn(async ({ documentId, locale }: any) => {
        calls.push({ uid, action: 'unpublish', params: { documentId, locale } });
        const old = find(uid, documentId, locale, 'published');
        if (old) entries.splice(entries.indexOf(old), 1);
        return { documentId, entries: [] };
      });
    }
    return api;
  };

  const cache = new Map<string, any>();
  return {
    entries,
    calls,
    documents: (uid: string) => {
      if (!cache.has(uid)) cache.set(uid, documents(uid));
      return cache.get(uid);
    },
    /** Seeds a stored version (populated source shape). */
    seed(uid: string, documentId: string, locale: string, status: Status, data: any) {
      entries.push({ uid, documentId, locale, status, data: clone(data) });
    },
    get(uid: string, documentId: string, locale: string, status: Status = 'draft') {
      return find(uid, documentId, locale, status)?.data;
    },
    failOn(uid: string, documentId: string) {
      failing.add(`${uid}#${documentId}`);
    },
    writes(action?: string) {
      return calls.filter((c) => c.action !== 'findMany' && (!action || c.action === action));
    },
  };
}
