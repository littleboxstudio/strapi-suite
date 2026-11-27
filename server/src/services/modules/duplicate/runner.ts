/**
 * Duplicate content: copies every localized `api::*` document of the default locale into a target
 * locale, translated with AI, through the Document Service (so the slug / page-attribute lifecycles
 * and the image-field middleware run as for a manual save). The run happens in the background; its
 * progress lives in the run log (DuplicateRunService).
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isEcommerceActive } from '../../../middlewares/ecommerceModuleGate';
import { listScope, collectLocalizedRelations, deepPopulate, type SchemaLookup } from './domain/scope';
import { buildPlan, nodeKey, type NodeKey, type PlanEdge } from './domain/plan';
import { applyStrings, collectStrings, toAiStrings, type StringField } from './domain/strings';
import { mapData, slugFieldOf } from './domain/mapData';
import { attributeAt, dropRelations, PARENT_PATH, topLevelKeys } from './domain/paths';
import { countEcommerce, loadEcommerceItems, type EcommerceCounts, type EcommerceItem } from './ecommerce';
import { DuplicateError } from './errors';
import { emptyCounts, type DuplicateCounts, type DuplicateCurrent, type DuplicateFailure } from './runs';

export type ExistingOption = 'skip' | 'replace';
export type StatusOption = 'follow' | 'draft';
export type DuplicateStartInput = {
  targetLocale: string;
  existing: ExistingOption;
  status: StatusOption;
  ecommerce: boolean;
};
export type DuplicateUser = { id: string | number | null; name: string | null };
export type DuplicateSummary = {
  sourceLocale: string;
  targetLocale: string;
  aiAvailable: boolean;
  contentTypes: { uid: string; displayName: string; count: number }[];
  ecommerce?: EcommerceCounts;
};

type Locale = { code: string; name: string };
type State = 'draft' | 'published';
type SideRow = { parentContentId?: string | null; parentContentModel?: string | null; templateId?: string | null; priority?: string | null; frequency?: string | null };
type SourceDoc = {
  key: NodeKey;
  uid: string;
  documentId: string;
  dp: boolean;
  slugField: string | null;
  draft: any;
  published: any | null;
  /** Page attributes / slug rows of the source, by state. */
  side: Partial<Record<State, { attribute?: SideRow; slug?: SideRow }>>;
  title?: string;
};
type Translated = { fields: StringField[]; translations: Record<string, string>; failed: boolean };
type Written = { mode: 'draft' | 'publish' | 'publish+draft'; translated: Partial<Record<State, Translated>> };

/** Documents read per Document Service call. */
const PAGE_SIZE = 100;
const TITLE_FIELDS = ['title', 'name', 'headline', 'label'];

const short = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;

/** A failure reason safe to store: the first line, no API key, at most 300 characters. */
const reasonOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split('\n')[0] || 'Error').replace(/sk-[A-Za-z0-9_*-]+/g, 'sk-…').slice(0, 300);
};

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** The page attributes a version carries (the row's own columns, such as its state, left out). */
const pageAttributes = (row?: SideRow) => [row?.templateId ?? null, row?.priority ?? null, row?.frequency ?? null];

const DuplicateService = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const runs = () => service('DuplicateRunService');
  const ai = () => service('AiTranslationModuleService');
  const i18n = () => strapi.plugin('i18n').service('locales');
  const config = (): LtbConfigs => strapi.config.get(`plugin::${PLUGIN_ID}`);
  const lookup: SchemaLookup = {
    contentType: (uid) => (strapi as any).contentTypes?.[uid],
    component: (uid) => (strapi as any).components?.[uid],
  };
  const docs = (uid: string): any => (strapi as any).documents(uid);

  let busy = false;
  let job: Promise<void> | null = null;

  const resolveLocales = async (targetLocale: unknown): Promise<{ source: Locale; target: Locale }> => {
    const all: any[] = (await i18n().find()) ?? [];
    const defaultCode: string = await i18n().getDefaultLocale();
    const toLocale = (l: any): Locale => ({ code: l.code, name: l.name ?? l.code });
    const source = all.find((l) => l.code === defaultCode);
    const target = all.find((l) => l.code === targetLocale);
    if (typeof targetLocale !== 'string' || !target || targetLocale === defaultCode) {
      throw new DuplicateError('invalid_locale');
    }
    return { source: source ? toLocale(source) : { code: defaultCode, name: defaultCode }, target: toLocale(target) };
  };

  const validateOptions = (input: any): DuplicateStartInput => {
    if (!['skip', 'replace'].includes(input?.existing)) throw new DuplicateError('invalid_option');
    if (!['follow', 'draft'].includes(input?.status)) throw new DuplicateError('invalid_option');
    if (input?.ecommerce !== undefined && typeof input.ecommerce !== 'boolean') {
      throw new DuplicateError('invalid_option');
    }
    return {
      targetLocale: input.targetLocale,
      existing: input.existing,
      status: input.status,
      ecommerce: input.ecommerce === true,
    };
  };

  const scope = () => listScope((strapi as any).contentTypes ?? {});

  // ---------------------------------------------------------------- the run

  async function execute(runId: number, input: DuplicateStartInput, source: Locale, target: Locale, user: DuplicateUser, withEcommerce: boolean) {
    const counts: DuplicateCounts = emptyCounts();
    let done = 0;
    let pendingFailures: DuplicateFailure[] = [];
    const reported = new Set<string>();
    const fail = (failure: DuplicateFailure) => {
      const id = `${failure.uid}#${failure.documentId}#${failure.reason}`;
      if (reported.has(id)) return;
      reported.add(id);
      pendingFailures.push(failure);
    };
    const flush = async (patch: { current?: DuplicateCurrent | null; total?: number } = {}) => {
      const failures = pendingFailures;
      pendingFailures = [];
      await runs().progress(runId, { done, counts: { ...counts }, failures, ...patch });
    };

    let credentials: any = null;
    try {
      credentials = await ai().getCredentials();
    } catch (e) {
      strapi.log?.warn?.(`[duplicate] AI credentials unavailable: ${errorName(e)}`);
    }

    /** Translates keyed strings; keys absent from the result were not translated. */
    const translateStrings = async (strings: Record<string, string>): Promise<Record<string, string>> => {
      if (!credentials || !Object.keys(strings).length) return {};
      try {
        const result = await ai().translateStrings(credentials, source, target, strings);
        return result?.translations ?? {};
      } catch (e) {
        strapi.log?.warn?.(`[duplicate] AI translation failed: ${errorName(e)}`);
        return {};
      }
    };

    // -------------------------------------------------- load the sources
    const sources = new Map<NodeKey, SourceDoc>();
    for (const entry of scope()) {
      try {
        await loadType(entry.uid, entry.draftAndPublish, source.code, sources);
      } catch (e) {
        fail({ uid: entry.uid, documentId: '', reason: `Contents could not be read: ${reasonOf(e)}` });
      }
    }

    let ecommerceItems: EcommerceItem[] = [];
    if (withEcommerce) {
      try {
        ecommerceItems = await loadEcommerceItems(strapi, {
          source: source.code,
          target: target.code,
          existing: input.existing,
          userId: user.id === null || user.id === undefined ? null : String(user.id),
          translate: translateStrings,
        });
      } catch (e) {
        fail({ uid: 'ecommerce', documentId: '', reason: `E-commerce translations could not be read: ${reasonOf(e)}` });
      }
    }

    // -------------------------------------------------- the plan
    const edges: PlanEdge[] = [];
    for (const doc of sources.values()) {
      for (const version of [doc.draft, doc.published]) {
        if (!version) continue;
        for (const ref of collectLocalizedRelations(doc.uid, version, lookup)) {
          edges.push({ from: doc.key, to: nodeKey(ref.targetUid, ref.documentId), path: ref.path });
        }
      }
      for (const state of ['draft', 'published'] as State[]) {
        const parent = parentOf(doc, state);
        if (parent) edges.push({ from: doc.key, to: nodeKey(parent.model, parent.id), path: PARENT_PATH });
      }
    }
    const required = (key: NodeKey, path: string) => {
      const doc = sources.get(key);
      if (!doc || path === PARENT_PATH) return false;
      const attribute = attributeAt(doc.uid, path, lookup, doc.draft) ?? attributeAt(doc.uid, path, lookup, doc.published);
      return attribute?.required === true;
    };
    const steps = buildPlan([...sources.keys()], edges, required);

    await flush({ total: sources.size + ecommerceItems.length });

    /** Documents whose target-locale version exists (written, or skipped because it existed). */
    const available = new Set<NodeKey>();
    const failed = new Set<NodeKey>();
    const written = new Map<NodeKey, Written>();

    const relationNote = (doc: SourceDoc, path: string, key: NodeKey) => {
      const [targetUid, targetId] = key.split('#');
      const why = failed.has(key) ? 'could not be duplicated' : 'is not part of the duplication';
      fail({
        uid: doc.uid,
        documentId: doc.documentId,
        ...(doc.title ? { title: doc.title } : {}),
        reason: `Relation "${path}" left empty: ${targetUid} ${targetId} ${why}`,
        kind: 'note',
      });
    };

    /** The target data of one version (translated, relations to missing documents removed). */
    /**
     * The slug and attribute rows the target document has for the state a write reaches (the draft,
     * or the single version without D&P), as the slug lifecycles look them up.
     */
    const targetSideRows = async (doc: SourceDoc) => {
      const cfg = config();
      const where = { state: doc.dp ? 'draft' : 'published', contentId: doc.documentId, locale: target.code };
      const [slug, attribute] = await Promise.all([
        strapi.db.query(cfg.uuid.modules.slug as any).findOne({ where }),
        strapi.db.query(cfg.uuid.modules.attribute as any).findOne({ where }),
      ]);
      return { slug: slug ?? null, attribute: attribute ?? null };
    };

    const prepare = async (doc: SourceDoc, state: State, deferred: Set<string>, replace: boolean, cached?: Translated) => {
      const version = state === 'published' ? doc.published : doc.draft;
      const drops: { path: string; documentId: string }[] = [];
      for (const ref of collectLocalizedRelations(doc.uid, version, lookup)) {
        const key = nodeKey(ref.targetUid, ref.documentId);
        if (deferred.has(ref.path) || available.has(key)) continue;
        drops.push({ path: ref.path, documentId: ref.documentId });
        relationNote(doc, ref.path, key);
      }
      const src = dropRelations(version, drops);
      let translated = cached;
      if (!translated) {
        const fields = collectStrings(doc.uid, src, lookup);
        const translations = fields.length ? await translateStrings(toAiStrings(fields)) : {};
        translated = { fields, translations, failed: false };
      }
      const mapped = mapData(doc.uid, src, lookup, { deferred: [...deferred], replace });
      const applied = applyStrings(mapped, translated.fields, translated.translations);
      if (!cached) translated.failed = applied.failed > 0;
      const data: Record<string, any> = applied.data;

      if (doc.slugField) {
        const slug = data[doc.slugField];
        delete data[doc.slugField];
        const current = await targetSideRows(doc);
        // An empty slug only clears an existing row: sending null without one would create a row
        // with a null slug.
        if (typeof slug === 'string' && slug) data.ltb_slug = slug;
        else if (replace && current.slug) data.ltb_slug = null;

        const side = doc.side[state]?.attribute;
        const parent = parentOf(doc, state);
        let parentId: string | null = null;
        let parentModel: string | null = null;
        if (parent && !deferred.has(PARENT_PATH)) {
          const key = nodeKey(parent.model, parent.id);
          if (available.has(key)) {
            parentId = parent.id;
            parentModel = parent.model;
          } else {
            relationNote(doc, 'parent', key);
          }
        }
        // Page attributes are sent when the source has some, or to clear the target's: sent empty
        // otherwise, the lifecycle would create an attribute row with nothing in it.
        if (side || parent || current.attribute || current.slug?.parentContentId) {
          data.ltb_attribute_parent = parentId;
          data.ltb_attribute_parent_model = parentModel;
          data.ltb_attribute_template = side?.templateId ?? null;
          data.ltb_attribute_priority = side?.priority ?? null;
          data.ltb_attribute_frequency = side?.frequency ?? null;
        }
      }
      return { data, translated };
    };

    /** What a version looks like before translation (to tell a published version from its draft). */
    const signature = (doc: SourceDoc, state: State) => {
      const version = state === 'published' ? doc.published : doc.draft;
      return JSON.stringify([
        mapData(doc.uid, version, lookup, {}),
        doc.slugField ? (version?.[doc.slugField] ?? null) : null,
        pageAttributes(doc.side[state]?.attribute),
        parentOf(doc, state),
      ]);
    };

    const write = (doc: SourceDoc, data: any) =>
      docs(doc.uid).update({ documentId: doc.documentId, locale: target.code, data });
    const publish = (doc: SourceDoc) => docs(doc.uid).publish({ documentId: doc.documentId, locale: target.code });

    const findTarget = async (doc: SourceDoc, status?: State) =>
      docs(doc.uid).findOne({
        documentId: doc.documentId,
        locale: target.code,
        ...(doc.dp && status ? { status } : {}),
        fields: ['documentId'],
      });

    const processDocument = async (doc: SourceDoc, deferredPaths: string[]) => {
      const targetDraft = await findTarget(doc, 'draft');
      const targetPublished = doc.dp ? await findTarget(doc, 'published') : null;
      const exists = !!(targetDraft || targetPublished);
      if (exists && input.existing === 'skip') {
        available.add(doc.key);
        counts.skipped += 1;
        return;
      }
      const deferred = new Set(deferredPaths);
      const follow = input.status === 'follow' && doc.dp;
      const translated: Partial<Record<State, Translated>> = {};
      let mode: Written['mode'] = 'draft';

      if (!follow || !doc.published) {
        const draft = await prepare(doc, 'draft', deferred, exists);
        translated.draft = draft.translated;
        await write(doc, draft.data);
        available.add(doc.key);
        // "Follow the original": a source never published leaves the target unpublished too.
        if (follow && targetPublished) await docs(doc.uid).unpublish({ documentId: doc.documentId, locale: target.code });
      } else {
        const same = signature(doc, 'draft') === signature(doc, 'published');
        const published = await prepare(doc, 'published', deferred, exists);
        translated.published = published.translated;
        await write(doc, published.data);
        available.add(doc.key);
        await publish(doc);
        mode = 'publish';
        if (!same) {
          const draft = await prepare(doc, 'draft', deferred, true);
          translated.draft = draft.translated;
          await write(doc, draft.data);
          mode = 'publish+draft';
        } else {
          translated.draft = published.translated;
        }
      }
      written.set(doc.key, { mode, translated });
      if (exists) counts.replaced += 1;
      else counts.duplicated += 1;
      if (Object.values(translated).some((t) => t?.failed || (t && t.fields.length > 0 && !credentials))) {
        counts.untranslated += 1;
      }
    };

    /** Sets the relations a cycle left empty: the whole top-level attributes holding them. */
    const fixDocument = async (doc: SourceDoc, paths: string[]) => {
      const memo = written.get(doc.key);
      if (!memo) return;
      const keys = topLevelKeys(paths);
      const withParent = paths.includes(PARENT_PATH);
      // With a published version and a different draft, the draft is overwritten with the whole
      // published version before publishing, then gets its whole draft back.
      const whole = memo.mode === 'publish+draft';
      const pick = async (state: State) => {
        const { data } = await prepare(doc, state, new Set(), true, memo.translated[state]);
        if (whole) return data;
        const out: Record<string, any> = {};
        for (const key of keys) if (key in data) out[key] = data[key];
        if (withParent && doc.slugField && 'ltb_attribute_parent' in data) {
          out.ltb_attribute_parent = data.ltb_attribute_parent;
          out.ltb_attribute_parent_model = data.ltb_attribute_parent_model;
        }
        return out;
      };
      if (memo.mode === 'draft') {
        await write(doc, await pick('draft'));
        return;
      }
      await write(doc, await pick('published'));
      await publish(doc);
      if (memo.mode === 'publish+draft') await write(doc, await pick('draft'));
    };

    const failureOf = (doc: SourceDoc, error: unknown): DuplicateFailure => ({
      uid: doc.uid,
      documentId: doc.documentId,
      ...(doc.title ? { title: doc.title } : {}),
      reason: reasonOf(error),
    });

    for (const step of steps) {
      const doc = sources.get(step.key);
      if (!doc) continue;
      if (step.kind === 'create') {
        await flush({ current: { uid: doc.uid, documentId: doc.documentId, ...(doc.title ? { title: doc.title } : {}) } });
        try {
          await processDocument(doc, step.deferred);
        } catch (e) {
          failed.add(doc.key);
          written.delete(doc.key);
          counts.failed += 1;
          fail(failureOf(doc, e));
          strapi.log?.warn?.(`[duplicate] ${doc.uid} could not be duplicated: ${errorName(e)}`);
        }
        done += 1;
        await flush();
        continue;
      }
      try {
        await fixDocument(doc, step.paths);
      } catch (e) {
        fail({ ...failureOf(doc, e), reason: `Relations could not be set: ${reasonOf(e)}` });
        strapi.log?.warn?.(`[duplicate] ${doc.uid} relations could not be set: ${errorName(e)}`);
      }
    }

    for (const item of ecommerceItems) {
      await flush({ current: { uid: item.uid, documentId: item.documentId, ...(item.title ? { title: item.title } : {}) } });
      try {
        const result = await item.run();
        counts[result.outcome] += 1;
        if (result.reason) {
          fail({ uid: item.uid, documentId: item.documentId, ...(item.title ? { title: item.title } : {}), reason: result.reason });
        }
        if (result.untranslated && (result.outcome !== 'skipped')) counts.untranslated += 1;
      } catch (e) {
        counts.failed += 1;
        fail({ uid: item.uid, documentId: item.documentId, ...(item.title ? { title: item.title } : {}), reason: reasonOf(e) });
        strapi.log?.warn?.(`[duplicate] ${item.uid} could not be duplicated: ${errorName(e)}`);
      }
      done += 1;
      await flush();
    }

    await flush({ current: null });
  }

  /** Every source-locale document of a type: its draft and (D&P) published versions, its side rows. */
  async function loadType(uid: string, dp: boolean, locale: string, sources: Map<NodeKey, SourceDoc>) {
    const populate = deepPopulate(uid, lookup);
    /** Every version of a state, by documentId (drafts and published versions match by it). */
    const readAll = async (status?: State) => {
      const out: any[] = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        const page: any[] =
          (await docs(uid).findMany({
            locale,
            ...(status ? { status } : {}),
            populate,
            // A stable order: without it, LIMIT/OFFSET pages may skip or repeat rows.
            sort: [{ documentId: 'asc' }, { id: 'asc' }],
            limit: PAGE_SIZE,
            start,
          })) ?? [];
        out.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return out;
    };
    const drafts = await readAll(dp ? 'draft' : undefined);
    if (!drafts.length) return;
    const published = new Map<string, any>();
    if (dp) for (const doc of await readAll('published')) published.set(doc.documentId, doc);

    const slugField = slugFieldOf(uid, lookup);
    const side = new Map<string, SourceDoc['side']>();
    if (slugField) {
      const cfg = config();
      const rowsOf = async (table: string) =>
        (await strapi.db.query(table as any).findMany({ where: { contentModel: uid, locale } })) ?? [];
      for (const [kind, table] of [['attribute', cfg.uuid.modules.attribute], ['slug', cfg.uuid.modules.slug]] as const) {
        for (const row of await rowsOf(table)) {
          const state: State = row.state === 'published' ? 'published' : 'draft';
          const entry = side.get(row.contentId) ?? {};
          entry[state] = { ...(entry[state] ?? {}), [kind]: row };
          side.set(row.contentId, entry);
        }
      }
    }

    const ct = lookup.contentType(uid);
    const titleOf = (doc: any) => {
      for (const name of TITLE_FIELDS) if (short(doc?.[name])) return short(doc[name]);
      for (const [name, attribute] of Object.entries<any>(ct?.attributes ?? {})) {
        if (attribute?.type === 'string' && name !== slugField && short(doc?.[name])) return short(doc[name]);
      }
      return short(slugField ? doc?.[slugField] : undefined);
    };

    for (const draft of drafts) {
      if (!draft?.documentId) continue;
      const key = nodeKey(uid, draft.documentId);
      // Without D&P the single version is the "draft" here, and its side rows are stored as published.
      const docSide = side.get(draft.documentId) ?? {};
      sources.set(key, {
        key,
        uid,
        documentId: draft.documentId,
        dp,
        slugField,
        draft,
        published: dp ? (published.get(draft.documentId) ?? null) : null,
        side: dp ? docSide : { draft: docSide.published ?? docSide.draft },
        title: titleOf(draft),
      });
    }
  }

  /** The parent page of a version (attribute row first, the slug row otherwise). */
  function parentOf(doc: SourceDoc, state: State): { id: string; model: string } | null {
    if (state === 'published' && !doc.published) return null;
    const rows = doc.side[state];
    const id = rows?.attribute?.parentContentId || rows?.slug?.parentContentId;
    const model = rows?.attribute?.parentContentModel || rows?.slug?.parentContentModel;
    return id && model ? { id, model } : null;
  }

  return {
    async summary(targetLocale: unknown, ecommerce: unknown): Promise<DuplicateSummary> {
      const { source, target } = await resolveLocales(targetLocale);
      let aiAvailable = false;
      try {
        aiAvailable = (await ai().getCredentials()) !== null;
      } catch {
        aiAvailable = false;
      }
      const contentTypes: DuplicateSummary['contentTypes'] = [];
      for (const entry of scope()) {
        const count = Number(await docs(entry.uid).count({ locale: source.code })) || 0;
        if (count === 0) continue;
        const ct = lookup.contentType(entry.uid);
        contentTypes.push({ uid: entry.uid, displayName: ct?.info?.displayName ?? entry.uid, count });
      }
      const summary: DuplicateSummary = { sourceLocale: source.code, targetLocale: target.code, aiAvailable, contentTypes };
      if (ecommerce === true && (await isEcommerceActive(strapi))) {
        summary.ecommerce = await countEcommerce(strapi, source.code);
      }
      return summary;
    },

    /** Validates and records the run, then runs it in the background (not awaited). */
    async start(rawInput: any, user: DuplicateUser): Promise<{ runId: number }> {
      const input = validateOptions(rawInput);
      const { source, target } = await resolveLocales(rawInput?.targetLocale);
      if (busy) throw new DuplicateError('RUN_IN_PROGRESS');
      busy = true;
      let runId: number;
      let withEcommerce = false;
      try {
        if (await runs().running()) throw new DuplicateError('RUN_IN_PROGRESS');
        withEcommerce = input.ecommerce && (await isEcommerceActive(strapi));
        runId = await runs().start({
          sourceLocale: source.code,
          targetLocale: target.code,
          options: { existing: input.existing, status: input.status, ecommerce: withEcommerce },
          userId: user?.id === null || user?.id === undefined ? null : String(user.id),
          userName: user?.name ?? null,
          total: 0,
        });
      } catch (e) {
        busy = false;
        throw e;
      }
      job = execute(runId, input, source, target, user, withEcommerce)
        .then(() => runs().finish(runId, 'SUCCESS'))
        .catch(async (e) => {
          strapi.log?.error?.(`[duplicate] run ${runId} failed: ${errorName(e)}`);
          try {
            await runs().progress(runId, { failure: { uid: 'run', documentId: '', reason: reasonOf(e) } });
            await runs().finish(runId, 'FAILED');
          } catch (inner) {
            strapi.log?.error?.(`[duplicate] run ${runId} could not be closed: ${errorName(inner)}`);
          }
        })
        .finally(() => {
          busy = false;
          job = null;
        });
      return { runId };
    },

    /** Resolves when no run of this process is in progress (tests, shutdown). */
    async whenIdle(): Promise<void> {
      if (job) await job;
    },
  };
};

export default DuplicateService;
