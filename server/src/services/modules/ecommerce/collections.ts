import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isBlank, resolveUniqueSlug, slugify } from './domain/catalog';
import {
  COLLECTION_SORTS,
  CollectionCondition,
  CollectionMatch,
  CollectionSort,
  EvaluableProduct,
  parseConditions,
  productMatches,
  sortEntries,
} from './domain/collections';
import { galleryCover, isGalleryPermutation } from './domain/galleryImages';
import { CategoryNode, subtreeIds } from './domain/organization';
import { EcommerceNotFoundError, EcommerceValidationError, ValidationIssue } from './errors';

const PAGE_SIZE = 50 as const;
/** Bulk product actions and member additions take at most this many product ids per call. */
const MAX_PRODUCT_IDS = 100 as const;
/** `string` attributes are varchar(255). */
const MAX_STRING = 255 as const;
/** Automated evaluation reads the catalogue this many products at a time. */
const EVALUATION_BATCH = 200 as const;

export type CollectionType = 'MANUAL' | 'AUTOMATED';

export type CollectionTranslationInput = {
  title: string;
  handle?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type CollectionInput = {
  type: CollectionType;
  /** Defaults to MANUAL for a manual collection and NEWEST for an automated one. */
  sortOrder?: CollectionSort;
  active: boolean;
  image: string | null;
  /** Automated collections only; ignored (stored empty) for manual ones. */
  match?: CollectionMatch;
  conditions?: CollectionCondition[];
  translations: Record<string, CollectionTranslationInput>;
};

export type CollectionListItem = {
  id: number;
  title: string;
  handle: string;
  type: CollectionType;
  active: boolean;
  productCount: number;
};

export type CollectionDetail = {
  id: number;
  type: CollectionType;
  sortOrder: CollectionSort;
  active: boolean;
  image: string | null;
  match: CollectionMatch;
  conditions: CollectionCondition[];
  translations: Record<string, Required<CollectionTranslationInput>>;
  productCount: number;
};

export type CollectionProductItem = {
  productId: number;
  name: string;
  thumbnailUrl: string | null;
  position: number;
};

export const BULK_PRODUCT_ACTIONS = [
  'addTag',
  'removeTag',
  'setCategory',
  'setProductType',
  'addToCollection',
  'removeFromCollection',
] as const;
export type BulkProductAction = (typeof BULK_PRODUCT_ACTIONS)[number];
export type BulkProductsInput = { productIds: number[]; action: BulkProductAction; value: number | null };

type Pagination = { page: number; pageSize: number; total: number; pageCount: number };

const invalid = (errors: ValidationIssue[], message = 'Invalid collection'): never => {
  throw new EcommerceValidationError(message, errors);
};

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** An image is an absolute http(s) URL or a site-relative path (never `javascript:` and the like). */
const validImageUrl = (url: string) => /^https?:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]*$/.test(url);

const cleanImage = (image: string | null | undefined) => (typeof image === 'string' && image.trim() ? image.trim() : null);

const pageOf = (raw: unknown) => Math.max(1, Math.floor(Number(raw)) || 1);
const paginate = (page: number, total: number): Pagination => ({
  page,
  pageSize: PAGE_SIZE,
  total,
  pageCount: Math.ceil(total / PAGE_SIZE),
});

/** A list of product ids: an array of positive integers, at most 100, deduplicated in order. */
const productIdList = (raw: unknown, { allowEmpty }: { allowEmpty: boolean }): number[] => {
  if (!Array.isArray(raw) || !raw.every(isPositiveInt)) invalid([{ path: 'productIds', code: 'invalid' }]);
  const ids = raw as number[];
  if (!ids.length && !allowEmpty) invalid([{ path: 'productIds', code: 'required' }]);
  if (ids.length > MAX_PRODUCT_IDS) invalid([{ path: 'productIds', code: 'too_many' }]);
  return [...new Set(ids)];
};

const EcommerceCollectionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const locales = () => strapi.plugin('i18n').service('locales');
  const getDefaultLocale = async (): Promise<string> => locales().getDefaultLocale();
  const localeCodes = async (): Promise<string[]> => ((await locales().find()) ?? []).map((l: any) => l.code);

  /** Text in `locale`, else the default locale, else any. */
  const pick = (translations: any[] = [], locale: string, defaultLocale: string, field: string): string =>
    translations.find((t) => t.locale === locale)?.[field] ??
    translations.find((t) => t.locale === defaultLocale)?.[field] ??
    translations[0]?.[field] ??
    '';

  const findCollection = async (id: number): Promise<any> => {
    const found = isPositiveInt(id) ? await strapi.db.query(uids().collection).findOne({ where: { id } }) : null;
    if (!found) throw new EcommerceNotFoundError('Collection not found');
    return found;
  };

  const requireManual = (collection: any, path = 'collection') => {
    if (collection.type !== 'MANUAL') invalid([{ path, code: 'COLLECTION_IS_AUTOMATED' }]);
  };

  const memberCount = (collectionId: number) =>
    strapi.db.query(uids().collectionProduct).count({ where: { collection: { id: collectionId } } });

  /**
   * Net units sold per product over the last 90 days: lines of non-cancelled, paid (or partly
   * refunded) orders, minus returned units, gifts excluded. One query per 500 products.
   */
  const unitsSold = async (productIds: number[], now: Date = new Date()): Promise<Map<number, number>> => {
    const totals = new Map<number, number>();
    const ids = [...new Set(productIds.filter((id) => Number.isInteger(id)))];
    const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < ids.length; i += 500) {
      const lines: any[] = await strapi.db.query(uids().orderLine).findMany({
        where: {
          productId: { $in: ids.slice(i, i + 500) },
          order: {
            orderStatus: { $ne: 'CANCELLED' },
            paymentStatus: { $in: ['PAID', 'PARTIALLY_REFUNDED'] },
            createdAt: { $gte: since },
          },
        },
        select: ['productId', 'quantity', 'returnedQuantity', 'isGift'],
      });
      for (const l of lines) {
        if (l.isGift === true) continue;
        const net = Math.max(0, (l.quantity ?? 0) - (l.returnedQuantity ?? 0));
        totals.set(l.productId, (totals.get(l.productId) ?? 0) + net);
      }
    }
    return totals;
  };

  /** Hooks provided by the automated-collection evaluation; a failure never undoes the change. */
  const afterCommit = async (label: string, work: () => Promise<unknown> | undefined) => {
    try {
      await work();
    } catch (e) {
      strapi.log?.warn?.(`[ecommerce] ${label} failed: ` + (e instanceof Error ? e.name : typeof e));
    }
  };

  type Normalized = {
    sortOrder: CollectionSort;
    match: CollectionMatch;
    conditions: CollectionCondition[];
  };

  const validateInput = async (
    input: CollectionInput,
    existing: any | null,
    defaultLocale: string
  ): Promise<Normalized> => {
    if (!input || typeof input !== 'object') invalid([{ path: 'body', code: 'invalid' }]);
    const errors: ValidationIssue[] = [];

    let type: CollectionType | null = null;
    if (existing) {
      type = existing.type;
      if (input.type !== undefined && input.type !== existing.type) errors.push({ path: 'type', code: 'immutable' });
    } else if (input.type === 'MANUAL' || input.type === 'AUTOMATED') {
      type = input.type;
    } else {
      errors.push({ path: 'type', code: 'invalid' });
    }

    let sortOrder: CollectionSort =
      existing?.sortOrder ?? (type === 'AUTOMATED' ? 'NEWEST' : 'MANUAL');
    if (input.sortOrder !== undefined && input.sortOrder !== null) {
      if (!COLLECTION_SORTS.includes(input.sortOrder) || (input.sortOrder === 'MANUAL' && type === 'AUTOMATED')) {
        errors.push({ path: 'sortOrder', code: 'invalid' });
      } else {
        sortOrder = input.sortOrder;
      }
    }

    let match: CollectionMatch = 'ALL';
    let conditions: CollectionCondition[] = [];
    if (type === 'AUTOMATED') {
      const parsed = parseConditions(input.conditions, input.match);
      errors.push(...parsed.errors);
      if (!parsed.errors.length && !parsed.conditions.length) errors.push({ path: 'conditions', code: 'required' });
      match = parsed.match;
      conditions = parsed.conditions;
    }

    if (typeof input.active !== 'boolean') errors.push({ path: 'active', code: 'invalid' });
    if (input.image !== null && input.image !== undefined) {
      if (typeof input.image !== 'string') errors.push({ path: 'image', code: 'invalid' });
      else if (input.image.trim().length > MAX_STRING) errors.push({ path: 'image', code: 'too_long' });
      else if (input.image.trim() && !validImageUrl(input.image.trim())) errors.push({ path: 'image', code: 'invalid_url' });
    }

    const translations = input.translations && typeof input.translations === 'object' ? input.translations : {};
    const known = await localeCodes();
    for (const [locale, t] of Object.entries(translations)) {
      const base = `translations.${locale}`;
      if (!known.includes(locale)) {
        errors.push({ path: base, code: 'invalid_locale' });
        continue;
      }
      for (const field of ['title', 'handle', 'seoTitle', 'seoDescription'] as const) {
        const v = (t as any)?.[field];
        if (v === null || v === undefined) continue;
        if (typeof v !== 'string') errors.push({ path: `${base}.${field}`, code: 'invalid' });
        else if (v.trim().length > MAX_STRING) errors.push({ path: `${base}.${field}`, code: 'too_long' });
      }
      const description = (t as any)?.description;
      if (description !== null && description !== undefined && typeof description !== 'string') {
        errors.push({ path: `${base}.description`, code: 'invalid' });
      }
    }
    const defaultTitle = translations[defaultLocale]?.title;
    if (typeof defaultTitle !== 'string' || isBlank(defaultTitle)) {
      errors.push({ path: `translations.${defaultLocale}.title`, code: 'required' });
    }

    if (errors.length) invalid(errors);
    return { sortOrder, match, conditions };
  };

  /** Upserts the translations. A blank non-default title removes that translation. */
  const saveTranslations = async (collectionId: number, translations: CollectionInput['translations']) => {
    const q = strapi.db.query(uids().collectionTranslation);
    const errors: ValidationIssue[] = [];
    for (const [locale, t] of Object.entries(translations ?? {})) {
      if (isBlank(t?.title as any)) {
        await q.deleteMany({ where: { collection: collectionId, locale } });
        continue;
      }
      const data = {
        locale,
        title: t.title.trim(),
        description: t.description ?? null,
        seoTitle: t.seoTitle?.trim() || null,
        seoDescription: t.seoDescription?.trim() || null,
        collection: collectionId,
      };
      const existing = await q.findOne({ where: { collection: collectionId, locale } });
      const requested = typeof t.handle === 'string' ? slugify(t.handle) : '';
      const taken: string[] = (
        await q.findMany({ where: { locale, collection: { id: { $ne: collectionId } } }, select: ['handle'] })
      ).map((r: any) => r.handle);
      let handle: string;
      if (requested) {
        if (taken.includes(requested)) {
          errors.push({ path: `translations.${locale}.handle`, code: 'duplicate_slug' });
          continue;
        }
        handle = requested;
      } else if (existing?.handle) {
        // Stable once set.
        handle = existing.handle;
      } else {
        handle = resolveUniqueSlug(slugify(t.title) || 'collection', taken);
      }
      if (existing) await q.update({ where: { id: existing.id }, data: { ...data, handle } });
      else await q.create({ data: { ...data, handle } });
    }
    if (errors.length) invalid(errors);
  };

  /** Appends products (not yet members) at the end of a collection: position max + 1. */
  const appendMembers = async (collectionId: number, productIds: number[]): Promise<number[]> => {
    const q = strapi.db.query(uids().collectionProduct);
    const rows: any[] = await q.findMany({
      where: { collection: { id: collectionId } },
      populate: { product: { select: ['id'] } },
    });
    const present = new Set(rows.map((r) => r.product?.id ?? r.product));
    let position = rows.reduce((max, r) => Math.max(max, r.position ?? 0), -1);
    const added: number[] = [];
    for (const productId of productIds) {
      if (present.has(productId)) continue;
      position += 1;
      await q.create({
        data: { collection: collectionId, product: productId, position, uniqueKey: `${collectionId}:${productId}` },
      });
      present.add(productId);
      added.push(productId);
    }
    return added;
  };

  /** Product ids among `ids` that exist; the others are reported as `productIds.<i>: unknown`. */
  const requireProducts = async (ids: number[]) => {
    const found: any[] = ids.length
      ? await strapi.db.query(uids().product).findMany({ where: { id: { $in: ids } }, select: ['id'] })
      : [];
    const known = new Set(found.map((r) => r.id));
    const errors = ids
      .map((id, i) => (known.has(id) ? null : { path: `productIds.${i}`, code: 'unknown' }))
      .filter((e): e is { path: string; code: string } => e !== null);
    if (errors.length) invalid(errors);
  };

  /** Thumbnail (product gallery cover, else the first variant's) per product id; one query. */
  const thumbnailsOf = async (productIds: number[]): Promise<Map<number, string | null>> => {
    const withImages: any[] = productIds.length
      ? await strapi.db.query(uids().product).findMany({
          where: { id: { $in: productIds } },
          select: ['id'],
          populate: {
            images: true,
            variants: { select: ['id', 'position'], populate: { images: true } },
          },
        })
      : [];
    return new Map<number, string | null>(
      withImages.map((p) => {
        const variants: any[] = [...(p.variants ?? [])].sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id
        );
        const thumb = galleryCover(p.images) ?? variants.map((v) => galleryCover(v.images)).find(Boolean) ?? null;
        return [p.id, (thumb as any)?.url ?? null];
      })
    );
  };

  type Rules = { id: number; match: CollectionMatch; conditions: CollectionCondition[] };

  const rulesOf = (row: any): Rules => {
    const parsed = parseConditions(row.conditions ?? [], row.match);
    // Stored rules were validated on save; anything unreadable evaluates as "no conditions" (no members).
    return { id: row.id, match: parsed.match, conditions: parsed.errors.length ? [] : parsed.conditions };
  };

  const automatedRules = async (): Promise<Rules[]> =>
    (
      await strapi.db.query(uids().collection).findMany({
        where: { type: 'AUTOMATED' },
        select: ['id', 'match', 'conditions'],
      })
    ).map(rulesOf);

  /** `categorySubtreeOf` over one categories query; each subtree is computed once. */
  const categoryTester = async (): Promise<(categoryId: number, productCategoryId: number | null) => boolean> => {
    const rows: any[] = await strapi.db.query(uids().category).findMany({
      select: ['id', 'position'],
      populate: { parent: { select: ['id'] } },
    });
    const nodes: CategoryNode[] = rows.map((r) => ({
      id: r.id,
      parentId: r.parent?.id ?? null,
      position: r.position ?? 0,
    }));
    const cache = new Map<number, Set<number>>();
    return (categoryId, productCategoryId) => {
      if (productCategoryId === null) return false;
      let subtree = cache.get(categoryId);
      if (!subtree) {
        subtree = new Set(subtreeIds(nodes, categoryId));
        cache.set(categoryId, subtree);
      }
      return subtree.has(productCategoryId);
    };
  };

  /** What evaluation needs of a product, in one query per batch (no N+1). */
  const EVALUATION_POPULATE = {
    translations: { select: ['locale', 'name'] },
    category: { select: ['id'] },
    productType: { select: ['id'] },
    tags: { select: ['id'] },
    variants: { select: ['active', 'price', 'compareAtPrice', 'stock'] },
  };

  const toEvaluable = (
    p: any,
    inCategory: (categoryId: number, productCategoryId: number | null) => boolean
  ): EvaluableProduct => {
    const productCategoryId: number | null = p.category?.id ?? null;
    return {
      id: p.id,
      active: p.active !== false,
      names: (p.translations ?? []).map((t: any) => t.name).filter((n: unknown) => typeof n === 'string'),
      vendor: typeof p.vendor === 'string' ? p.vendor : null,
      categorySubtreeOf: (categoryId) => inCategory(categoryId, productCategoryId),
      productTypeId: p.productType?.id ?? null,
      tagIds: (p.tags ?? []).map((t: any) => t.id),
      variants: (p.variants ?? []).map((v: any) => ({
        active: v.active !== false,
        price: v.price ?? 0,
        compareAtPrice: v.compareAtPrice ?? null,
        stock: v.stock ?? 0,
      })),
    };
  };

  /** Walks the catalogue by id ascending, `EVALUATION_BATCH` products at a time. */
  const eachCatalogueBatch = async (visit: (products: any[]) => void) => {
    let lastId = 0;
    for (;;) {
      const batch: any[] = await strapi.db.query(uids().product).findMany({
        where: { id: { $gt: lastId } },
        select: ['id', 'active', 'vendor'],
        populate: EVALUATION_POPULATE,
        orderBy: { id: 'asc' },
        limit: EVALUATION_BATCH,
      });
      if (!batch.length) return;
      visit(batch);
      if (batch.length < EVALUATION_BATCH) return;
      lastId = batch[batch.length - 1].id;
    }
  };

  /** Product ids of every product matching `rules`, across the whole catalogue. */
  const matchingProductIds = async (rules: Pick<Rules, 'match' | 'conditions'>): Promise<number[]> => {
    const inCategory = await categoryTester();
    const ids: number[] = [];
    await eachCatalogueBatch((products) => {
      for (const p of products) {
        if (productMatches(toEvaluable(p, inCategory), rules.conditions, rules.match)) ids.push(p.id);
      }
    });
    return ids;
  };

  const rowProductId = (r: any): number | null => r.product?.id ?? (typeof r.product === 'number' ? r.product : null);

  const service = {
    /** Net units sold in the last 90 days per product (for best-selling order). */
    unitsSoldByProduct: (productIds: number[], now: Date = new Date()) => unitsSold(productIds, now),

    async list(params: { page?: number; search?: string; locale?: string } = {}) {
      const u = uids();
      const page = pageOf(params.page);
      const search = typeof params.search === 'string' ? params.search.trim() : '';
      const defaultLocale = await getDefaultLocale();
      const locale = params.locale || defaultLocale;
      const where = search
        ? {
            $or: [
              { translations: { title: { $containsi: search } } },
              { translations: { handle: { $containsi: search } } },
            ],
          }
        : {};
      const q = strapi.db.query(u.collection);
      const [rows, total] = await Promise.all([
        q.findMany({
          where,
          orderBy: { id: 'desc' },
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          populate: { translations: true },
        }),
        q.count({ where }),
      ]);
      const results: CollectionListItem[] = [];
      for (const r of rows as any[]) {
        results.push({
          id: r.id,
          title: pick(r.translations, locale, defaultLocale, 'title'),
          handle: pick(r.translations, locale, defaultLocale, 'handle'),
          type: r.type,
          active: r.active !== false,
          productCount: await memberCount(r.id),
        });
      }
      return { results, pagination: paginate(page, total) };
    },

    async get(id: number): Promise<CollectionDetail> {
      await findCollection(id);
      const r = await strapi.db.query(uids().collection).findOne({ where: { id }, populate: { translations: true } });
      const translations: CollectionDetail['translations'] = {};
      for (const t of r.translations ?? []) {
        translations[t.locale] = {
          title: t.title,
          handle: t.handle,
          description: t.description ?? null,
          seoTitle: t.seoTitle ?? null,
          seoDescription: t.seoDescription ?? null,
        };
      }
      const parsed = parseConditions(r.conditions ?? [], r.match);
      return {
        id: r.id,
        type: r.type,
        sortOrder: r.sortOrder ?? (r.type === 'AUTOMATED' ? 'NEWEST' : 'MANUAL'),
        active: r.active !== false,
        image: r.image ?? null,
        match: parsed.match,
        conditions: parsed.conditions,
        translations,
        productCount: await memberCount(r.id),
      };
    },

    async create(input: CollectionInput): Promise<{ id: number }> {
      const defaultLocale = await getDefaultLocale();
      const n = await validateInput(input, null, defaultLocale);
      const id: number = await strapi.db.transaction(async () => {
        const created = await strapi.db.query(uids().collection).create({
          data: {
            type: input.type,
            sortOrder: n.sortOrder,
            active: input.active,
            image: cleanImage(input.image),
            match: n.match,
            conditions: n.conditions,
          },
        });
        await saveTranslations(created.id, input.translations);
        return created.id;
      });
      if (input.type === 'AUTOMATED') {
        await afterCommit('collection recalculation', () => service.recalculate(id));
      }
      return { id };
    },

    /** The type never changes; an automated collection is re-evaluated when its rules change. */
    async update(id: number, input: CollectionInput): Promise<void> {
      const found = await findCollection(id);
      const defaultLocale = await getDefaultLocale();
      const n = await validateInput(input, found, defaultLocale);
      const before = parseConditions(found.conditions ?? [], found.match);
      const rulesChanged =
        found.type === 'AUTOMATED' &&
        (before.match !== n.match || JSON.stringify(before.conditions) !== JSON.stringify(n.conditions));
      await strapi.db.transaction(async () => {
        await strapi.db.query(uids().collection).update({
          where: { id },
          data: {
            sortOrder: n.sortOrder,
            active: input.active,
            image: cleanImage(input.image),
            match: n.match,
            conditions: n.conditions,
          },
        });
        await saveTranslations(id, input.translations);
      });
      if (rulesChanged) await afterCommit('collection recalculation', () => service.recalculate(id));
    },

    /** Removes the collection, its translations and memberships; products are never deleted. */
    async delete(id: number): Promise<void> {
      await findCollection(id);
      const u = uids();
      await strapi.db.transaction(async () => {
        await strapi.db.query(u.collectionProduct).deleteMany({ where: { collection: { id } } });
        await strapi.db.query(u.collectionTranslation).deleteMany({ where: { collection: id } });
        await strapi.db.query(u.collection).delete({ where: { id } });
      });
    },

    /** Members in the collection's sort order (any kind of collection), paginated. */
    async listProducts(id: number, params: { page?: number; locale?: string } = {}) {
      const collection = await findCollection(id);
      const page = pageOf(params.page);
      const defaultLocale = await getDefaultLocale();
      const known = await localeCodes();
      const locale = typeof params.locale === 'string' && known.includes(params.locale) ? params.locale : defaultLocale;
      // Every member, with only what sorting needs; images are read for the page alone.
      const rows: any[] = await strapi.db.query(uids().collectionProduct).findMany({
        where: { collection: { id } },
        select: ['id', 'position'],
        populate: {
          product: {
            select: ['id'],
            populate: {
              translations: { select: ['locale', 'name'] },
              variants: { select: ['active', 'price', 'position'] },
            },
          },
        },
      });
      const members = rows.filter((r) => r.product);
      const sold = await unitsSold(members.map((r) => r.product.id));
      const entries = members.map((r) => {
        const p = r.product;
        const variants: any[] = p.variants ?? [];
        const active = variants.filter((v) => v.active !== false);
        const prices = (active.length ? active : variants).map((v) => v.price ?? 0);
        return {
          id: p.id as number,
          name: pick(p.translations, locale, defaultLocale, 'name'),
          priceMin: prices.length ? Math.min(...prices) : 0,
          priceMax: prices.length ? Math.max(...prices) : 0,
          unitsSold: sold.get(p.id) ?? 0,
          position: r.position ?? 0,
        };
      });
      const sortOrder: CollectionSort =
        collection.sortOrder ?? (collection.type === 'AUTOMATED' ? 'NEWEST' : 'MANUAL');
      const sorted = sortEntries(entries, sortOrder, locale);
      const pageEntries = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      const thumbnails = await thumbnailsOf(pageEntries.map((e) => e.id));
      const results: CollectionProductItem[] = pageEntries.map((e) => ({
        productId: e.id,
        name: e.name,
        thumbnailUrl: thumbnails.get(e.id) ?? null,
        position: e.position,
      }));
      return { results, pagination: paginate(page, sorted.length) };
    },

    /** Adds products to a manual collection, last; existing members are left in place. */
    async addProducts(id: number, productIds: number[]): Promise<void> {
      const collection = await findCollection(id);
      requireManual(collection);
      const ids = productIdList(productIds, { allowEmpty: true });
      await requireProducts(ids);
      await strapi.db.transaction(async () => {
        await appendMembers(id, ids);
      });
    },

    async removeProducts(id: number, productIds: number[]): Promise<void> {
      const collection = await findCollection(id);
      requireManual(collection);
      const ids = productIdList(productIds, { allowEmpty: true });
      if (!ids.length) return;
      await strapi.db.query(uids().collectionProduct).deleteMany({
        where: { collection: { id }, product: { id: { $in: ids } } },
      });
    },

    /** `productIds` must name every current member exactly once (a stale list is refused). */
    async reorderProducts(id: number, productIds: number[]): Promise<void> {
      const collection = await findCollection(id);
      requireManual(collection);
      const q = strapi.db.query(uids().collectionProduct);
      const rows: any[] = await q.findMany({
        where: { collection: { id } },
        populate: { product: { select: ['id'] } },
      });
      const byProduct = new Map<number, any>(rows.map((r) => [r.product?.id ?? r.product, r]));
      if (!isGalleryPermutation([...byProduct.keys()], productIds)) {
        invalid([{ path: 'productIds', code: 'not_permutation' }]);
      }
      await strapi.db.transaction(async () => {
        for (let i = 0; i < productIds.length; i += 1) {
          const row = byProduct.get(productIds[i]);
          if ((row.position ?? 0) !== i) await q.update({ where: { id: row.id }, data: { position: i } });
        }
      });
    },

    /**
     * One action over up to 100 products. `updated` counts the products actually changed (a tag
     * they already had, or a category they already were in, is not a change). The changed
     * products are re-evaluated against the automated collections after the commit.
     */
    async bulkProducts(input: BulkProductsInput): Promise<{ updated: number }> {
      const u = uids();
      if (!input || typeof input !== 'object') invalid([{ path: 'body', code: 'invalid' }], 'Invalid bulk action');
      const { action, value } = input;
      if (!BULK_PRODUCT_ACTIONS.includes(action)) invalid([{ path: 'action', code: 'invalid' }], 'Invalid bulk action');
      const ids = (() => {
        try {
          return productIdList(input.productIds, { allowEmpty: false });
        } catch (e) {
          if (e instanceof EcommerceValidationError) invalid(e.errors, 'Invalid bulk action');
          throw e;
        }
      })();
      const nullable = action === 'setCategory' || action === 'setProductType';
      if (!(isPositiveInt(value) || (nullable && value === null))) {
        invalid([{ path: 'value', code: 'invalid' }], 'Invalid bulk action');
      }
      const targetUid =
        action === 'addTag' || action === 'removeTag'
          ? u.tag
          : action === 'setCategory'
            ? u.category
            : action === 'setProductType'
              ? u.productType
              : u.collection;
      if (value !== null) {
        const target = await strapi.db.query(targetUid).findOne({ where: { id: value } });
        if (!target) invalid([{ path: 'value', code: 'unknown' }], 'Invalid bulk action');
        if (targetUid === u.collection) requireManual(target, 'value');
      }
      try {
        await requireProducts(ids);
      } catch (e) {
        if (e instanceof EcommerceValidationError) invalid(e.errors, 'Invalid bulk action');
        throw e;
      }

      const changed: number[] = await strapi.db.transaction(async () => {
        const products = strapi.db.query(u.product);
        switch (action) {
          case 'addTag':
          case 'removeTag': {
            const rows: any[] = await products.findMany({
              where: { id: { $in: ids } },
              select: ['id'],
              populate: { tags: { select: ['id'] } },
            });
            const has = new Set(rows.filter((r) => (r.tags ?? []).some((t: any) => t.id === value)).map((r) => r.id));
            const todo = ids.filter((id) => (action === 'addTag' ? !has.has(id) : has.has(id)));
            for (const id of todo) {
              await products.update({
                where: { id },
                data: { tags: action === 'addTag' ? { connect: [value] } : { disconnect: [value] } },
              });
            }
            return todo;
          }
          case 'setCategory':
          case 'setProductType': {
            const field = action === 'setCategory' ? 'category' : 'productType';
            const rows: any[] = await products.findMany({
              where: { id: { $in: ids } },
              select: ['id'],
              populate: { [field]: { select: ['id'] } },
            });
            const current = new Map(rows.map((r) => [r.id, r[field]?.id ?? null]));
            const todo = ids.filter((id) => current.get(id) !== value);
            for (const id of todo) await products.update({ where: { id }, data: { [field]: value } });
            return todo;
          }
          case 'addToCollection':
            return appendMembers(value as number, ids);
          case 'removeFromCollection': {
            const q = strapi.db.query(u.collectionProduct);
            const rows: any[] = await q.findMany({
              where: { collection: { id: value }, product: { id: { $in: ids } } },
              populate: { product: { select: ['id'] } },
            });
            await q.deleteMany({ where: { collection: { id: value }, product: { id: { $in: ids } } } });
            const removed = new Set(rows.map((r) => r.product?.id ?? r.product));
            return ids.filter((id) => removed.has(id));
          }
          default:
            return [];
        }
      });
      if (changed.length) {
        await afterCommit('collection sync after a bulk product action', () => service.syncProducts(changed));
      }
      return { updated: changed.length };
    },

    /**
     * Re-evaluates these products against every AUTOMATED collection and applies the difference
     * (adds missing memberships, removes extra ones). A product that no longer exists leaves every
     * automated collection. Idempotent; reuses the caller's transaction when there is one.
     */
    async syncProducts(productIds: number[]): Promise<void> {
      const ids = [...new Set((productIds ?? []).filter(isPositiveInt))];
      if (!ids.length) return;
      const rules = await automatedRules();
      if (!rules.length) return;
      const u = uids();
      await strapi.db.transaction(async () => {
        const products: any[] = await strapi.db.query(u.product).findMany({
          where: { id: { $in: ids } },
          select: ['id', 'active', 'vendor'],
          populate: EVALUATION_POPULATE,
        });
        const inCategory = await categoryTester();
        const evaluable = new Map(products.map((p) => [p.id as number, toEvaluable(p, inCategory)]));
        const memberships: any[] = await strapi.db.query(u.collectionProduct).findMany({
          where: { product: { id: { $in: ids } }, collection: { type: 'AUTOMATED' } },
          select: ['id'],
          populate: { collection: { select: ['id'] }, product: { select: ['id'] } },
        });
        const present = new Map<string, number>();
        for (const m of memberships) {
          const productId = rowProductId(m);
          const collectionId = m.collection?.id ?? m.collection;
          if (productId !== null && collectionId) present.set(`${collectionId}:${productId}`, m.id);
        }
        const extra: number[] = [];
        for (const r of rules) {
          for (const productId of ids) {
            const key = `${r.id}:${productId}`;
            const p = evaluable.get(productId);
            const wanted = !!p && productMatches(p, r.conditions, r.match);
            const rowId = present.get(key);
            if (wanted && rowId === undefined) {
              await strapi.db.query(u.collectionProduct).create({
                data: { collection: r.id, product: productId, position: 0, uniqueKey: key },
              });
            } else if (!wanted && rowId !== undefined) {
              extra.push(rowId);
            }
          }
        }
        if (extra.length) await strapi.db.query(u.collectionProduct).deleteMany({ where: { id: { $in: extra } } });
      });
    },

    /**
     * Re-evaluates an automated collection over the whole catalogue (batches of 200 by id) and
     * applies the difference. A manual collection is left alone.
     */
    async recalculate(id: number): Promise<{ added: number; removed: number }> {
      const collection = await findCollection(id);
      if (collection.type !== 'AUTOMATED') return { added: 0, removed: 0 };
      const wanted = new Set(await matchingProductIds(rulesOf(collection)));
      const q = strapi.db.query(uids().collectionProduct);
      return strapi.db.transaction(async () => {
        const rows: any[] = await q.findMany({
          where: { collection: { id } },
          select: ['id'],
          populate: { product: { select: ['id'] } },
        });
        const present = new Set<number>();
        const extra: number[] = [];
        for (const r of rows) {
          const productId = rowProductId(r);
          if (productId !== null && wanted.has(productId) && !present.has(productId)) present.add(productId);
          else extra.push(r.id);
        }
        let added = 0;
        for (const productId of wanted) {
          if (present.has(productId)) continue;
          await q.create({ data: { collection: id, product: productId, position: 0, uniqueKey: `${id}:${productId}` } });
          added += 1;
        }
        if (extra.length) await q.deleteMany({ where: { id: { $in: extra } } });
        return { added, removed: extra.length };
      });
    },

    /** Recalculates every automated collection with at least one CATEGORY condition. */
    async recalculateWhere(filter: { categoryConditions: true }): Promise<void> {
      if (!filter?.categoryConditions) return;
      for (const r of await automatedRules()) {
        if (r.conditions.some((c) => c.field === 'CATEGORY')) await service.recalculate(r.id);
      }
    },

    /** The products `conditions` would select (newest first, paginated); nothing is stored. */
    async preview(input: {
      match: unknown;
      conditions: unknown;
      page?: number;
      locale?: string;
    }): Promise<{ results: { productId: number; name: string; thumbnailUrl: string | null }[]; pagination: Pagination }> {
      const parsed = parseConditions(input?.conditions, input?.match);
      if (parsed.errors.length) invalid(parsed.errors);
      if (!parsed.conditions.length) invalid([{ path: 'conditions', code: 'required' }]);
      const page = pageOf(input?.page);
      const defaultLocale = await getDefaultLocale();
      const locale = input?.locale || defaultLocale;
      const inCategory = await categoryTester();
      const matches: { id: number; translations: any[] }[] = [];
      await eachCatalogueBatch((products) => {
        for (const p of products) {
          if (productMatches(toEvaluable(p, inCategory), parsed.conditions, parsed.match)) {
            matches.push({ id: p.id, translations: p.translations ?? [] });
          }
        }
      });
      matches.sort((a, b) => b.id - a.id);
      const pageRows = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const thumbnails = await thumbnailsOf(pageRows.map((m) => m.id));
      return {
        results: pageRows.map((m) => ({
          productId: m.id,
          name: pick(m.translations, locale, defaultLocale, 'name'),
          thumbnailUrl: thumbnails.get(m.id) ?? null,
        })),
        pagination: paginate(page, matches.length),
      };
    },
  };

  return service;
};

export default EcommerceCollectionService;
