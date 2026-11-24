import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isBlank, resolveUniqueSlug, slugify } from './domain/catalog';
import { parseConditions, referencedIds } from './domain/collections';
import { CategoryNode, moveError, nameKey } from './domain/organization';
import { EcommerceNotFoundError, EcommerceValidationError, ValidationIssue } from './errors';

const PAGE_SIZE = 50 as const;
/** `string` attributes are varchar(255). */
const MAX_STRING = 255 as const;

export type Translations<T> = Record<string, T>;

export type CategoryTranslationInput = {
  name: string;
  slug?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type CategoryInput = {
  parentId: number | null;
  active: boolean;
  translations: Translations<CategoryTranslationInput>;
};

export type CategoryTreeNode = {
  id: number;
  parentId: number | null;
  position: number;
  active: boolean;
  name: string;
  slug: string;
  /** Products directly in this category (not its subcategories). */
  productCount: number;
  children: CategoryTreeNode[];
};

export type CategoryDetail = {
  id: number;
  parentId: number | null;
  position: number;
  active: boolean;
  translations: Translations<Required<CategoryTranslationInput>>;
  productCount: number;
  childCount: number;
};

export type NamedInput = { translations: Translations<{ name: string }> };

export type NamedListItem = {
  id: number;
  name: string;
  translations: Translations<{ name: string }>;
  productCount: number;
};

export type NamedPage = {
  results: NamedListItem[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
};

/** Trimmed, inner whitespace collapsed: how type and tag names are stored. */
const cleanName = (name: string) => String(name ?? '').trim().replace(/\s+/g, ' ');

const invalid = (errors: ValidationIssue[], message = 'Invalid request'): never => {
  throw new EcommerceValidationError(message, errors);
};

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

const EcommerceOrganizationService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const locales = () => strapi.plugin('i18n').service('locales');
  const getDefaultLocale = async (): Promise<string> => locales().getDefaultLocale();
  const localeCodes = async (): Promise<string[]> => ((await locales().find()) ?? []).map((l: any) => l.code);

  /** Name in `locale`, else the default locale, else any. */
  const pickName = (translations: any[] = [], locale: string, defaultLocale: string, field = 'name'): string =>
    translations.find((t) => t.locale === locale)?.[field] ??
    translations.find((t) => t.locale === defaultLocale)?.[field] ??
    translations[0]?.[field] ??
    '';

  /** Collections whose automated conditions reference one of the given ids, by title (default locale). */
  const collectionsReferencing = async (
    kind: 'categoryIds' | 'tagIds',
    id: number
  ): Promise<ValidationIssue[]> => {
    const u = uids();
    const defaultLocale = await getDefaultLocale();
    const rows: any[] = await strapi.db.query(u.collection).findMany({
      where: { type: 'AUTOMATED' },
      populate: { translations: true },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter((c) => referencedIds(parseConditions(c.conditions, c.match).conditions)[kind].includes(id))
      .map((c) => ({
        path: 'collections',
        code: 'IN_USE_BY_COLLECTIONS',
        detail: pickName(c.translations, defaultLocale, defaultLocale, 'title') || `#${c.id}`,
      }));
  };

  // ------------------------------------------------------------------ categories

  const loadCategories = async (): Promise<any[]> =>
    strapi.db.query(uids().category).findMany({
      populate: { translations: true, parent: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

  const toNodes = (rows: any[]): CategoryNode[] =>
    rows.map((r) => ({
      id: r.id,
      parentId: r.parent?.id ?? null,
      position: r.position ?? 0,
    }));

  const siblingsOf = (nodes: CategoryNode[], parentId: number | null, exceptId?: number) =>
    nodes
      .filter((n) => n.parentId === parentId && n.id !== exceptId)
      .sort((a, b) => a.position - b.position || a.id - b.id);

  /** Writes positions 0..n for the given order (only rows whose position or parent changes). */
  const writeOrder = async (ordered: CategoryNode[], parentId: number | null) => {
    const u = uids();
    for (let i = 0; i < ordered.length; i += 1) {
      const n = ordered[i];
      if (n.position === i && n.parentId === parentId) continue;
      await strapi.db.query(u.category).update({ where: { id: n.id }, data: { position: i, parent: parentId } });
    }
  };

  const productCounts = async (): Promise<Map<number, number>> => {
    const rows: any[] = await strapi.db.query(uids().product).findMany({
      where: { category: { id: { $null: false } } },
      select: ['id'],
      populate: { category: { select: ['id'] } },
    });
    const counts = new Map<number, number>();
    for (const r of rows) {
      const id = r.category?.id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };

  const recalculateCategoryConditions = async () => {
    try {
      const collections: { recalculateWhere(filter: { categoryConditions: true }): Promise<unknown> } =
        strapi.plugin(PLUGIN_ID).service('EcommerceCollectionService');
      await collections.recalculateWhere({ categoryConditions: true });
    } catch (e) {
      // The change is committed; the collections' Recalculate button repairs memberships.
      strapi.log?.warn?.(
        '[ecommerce] collection recalculation after a category change failed: ' + (e instanceof Error ? e.name : typeof e)
      );
    }
  };

  const validateParent = (nodes: CategoryNode[], id: number | null, parentId: unknown): ValidationIssue[] => {
    if (parentId === null || parentId === undefined) return [];
    if (!isPositiveInt(parentId)) return [{ path: 'parentId', code: 'invalid' }];
    if (!nodes.some((n) => n.id === parentId)) return [{ path: 'parentId', code: 'unknown' }];
    // A new category is a leaf: a virtual node of height 1.
    const error = moveError(id === null ? [...nodes, { id: -1, parentId: null, position: 0 }] : nodes, id ?? -1, parentId);
    return error ? [{ path: 'parentId', code: error }] : [];
  };

  const validateCategoryInput = async (input: CategoryInput, defaultLocale: string): Promise<ValidationIssue[]> => {
    const errors: ValidationIssue[] = [];
    if (!input || typeof input !== 'object') return [{ path: 'body', code: 'invalid' }];
    if (typeof input.active !== 'boolean') errors.push({ path: 'active', code: 'invalid' });
    const translations = input.translations && typeof input.translations === 'object' ? input.translations : {};
    const known = await localeCodes();
    for (const [locale, t] of Object.entries(translations)) {
      const base = `translations.${locale}`;
      if (!known.includes(locale)) {
        errors.push({ path: base, code: 'invalid_locale' });
        continue;
      }
      for (const field of ['name', 'slug', 'seoTitle', 'seoDescription'] as const) {
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
    if (isBlank(translations[defaultLocale]?.name as any)) {
      errors.push({ path: `translations.${defaultLocale}.name`, code: 'required' });
    }
    return errors;
  };

  /** Upserts the translations of a category. A blank non-default name removes that translation. */
  const saveCategoryTranslations = async (categoryId: number, translations: Translations<CategoryTranslationInput>) => {
    const u = uids();
    const q = strapi.db.query(u.categoryTranslation);
    for (const [locale, t] of Object.entries(translations ?? {})) {
      if (isBlank(t?.name as any)) {
        await q.deleteMany({ where: { category: categoryId, locale } });
        continue;
      }
      const data = {
        locale,
        name: t.name.trim(),
        description: t.description ?? null,
        seoTitle: t.seoTitle?.trim() || null,
        seoDescription: t.seoDescription?.trim() || null,
        category: categoryId,
      };
      const existing = await q.findOne({ where: { category: categoryId, locale } });
      const requested = typeof t.slug === 'string' ? slugify(t.slug) : '';
      const taken: string[] = (
        await q.findMany({ where: { locale, category: { id: { $ne: categoryId } } }, select: ['slug'] })
      ).map((r: any) => r.slug);
      let slug: string;
      if (requested) {
        // Taken by another category in this locale: "-2", "-3", … is added.
        slug = resolveUniqueSlug(requested, taken);
      } else if (existing?.slug) {
        // Stable once set.
        slug = existing.slug;
      } else {
        slug = resolveUniqueSlug(slugify(t.name) || 'category', taken);
      }
      if (existing) await q.update({ where: { id: existing.id }, data: { ...data, slug } });
      else await q.create({ data: { ...data, slug } });
    }
  };

  // ------------------------------------------------------------------ tags

  /** Unlinks every product from tag `id` (products are never deleted). */
  const unlinkTagProducts = async (id: number) => {
    const q = strapi.db.query(uids().product);
    const rows: any[] = await q.findMany({ where: { tags: { id } }, select: ['id'] });
    for (const r of rows) await q.update({ where: { id: r.id }, data: { tags: { disconnect: [id] } } });
  };

  const listTags = async (
    params: { page?: number; search?: string; locale?: string } = {}
  ): Promise<NamedPage> => {
    const page = Math.max(1, Math.floor(Number(params.page)) || 1);
    const search = typeof params.search === 'string' ? params.search.trim() : '';
    const defaultLocale = await getDefaultLocale();
    const locale = params.locale || defaultLocale;
    const where = search
      ? { $or: [{ key: { $containsi: search } }, { translations: { name: { $containsi: search } } }] }
      : {};
    const q = strapi.db.query(uids().tag);
    const [rows, total] = await Promise.all([
      q.findMany({
        where,
        orderBy: { key: 'asc' },
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        populate: { translations: true },
      }),
      q.count({ where }),
    ]);
    const results: NamedListItem[] = [];
    for (const r of rows as any[]) {
      results.push({
        id: r.id,
        name: pickName(r.translations, locale, defaultLocale),
        translations: Object.fromEntries((r.translations ?? []).map((t: any) => [t.locale, { name: t.name }])),
        productCount: await strapi.db.query(uids().product).count({ where: { tags: { id: r.id } } }),
      });
    }
    return { results, pagination: { page, pageSize: PAGE_SIZE, total, pageCount: Math.ceil(total / PAGE_SIZE) } };
  };

  const validateTag = async (
    id: number | null,
    input: NamedInput,
    defaultLocale: string
  ): Promise<string> => {
    const errors: ValidationIssue[] = [];
    const translations = input?.translations && typeof input.translations === 'object' ? input.translations : {};
    const known = await localeCodes();
    for (const [locale, t] of Object.entries(translations)) {
      const name = (t as any)?.name;
      if (!known.includes(locale)) errors.push({ path: `translations.${locale}`, code: 'invalid_locale' });
      else if (name !== null && name !== undefined && typeof name !== 'string')
        errors.push({ path: `translations.${locale}.name`, code: 'invalid' });
      else if (typeof name === 'string' && cleanName(name).length > MAX_STRING)
        errors.push({ path: `translations.${locale}.name`, code: 'too_long' });
    }
    const defaultName = translations[defaultLocale]?.name;
    const key = typeof defaultName === 'string' ? nameKey(defaultName) : '';
    if (!key) errors.push({ path: `translations.${defaultLocale}.name`, code: 'required' });
    if (errors.length) invalid(errors, 'Invalid tag');
    const clash = await strapi.db.query(uids().tag).findOne({ where: { key } });
    if (clash && clash.id !== id) {
      invalid([{ path: `translations.${defaultLocale}.name`, code: 'NAME_TAKEN' }], 'Invalid tag');
    }
    return key;
  };

  const saveTagTranslations = async (ownerId: number, translations: NamedInput['translations']) => {
    const q = strapi.db.query(uids().tagTranslation);
    for (const [locale, t] of Object.entries(translations ?? {})) {
      const name = cleanName(t?.name ?? '');
      if (!name) {
        await q.deleteMany({ where: { tag: ownerId, locale } });
        continue;
      }
      const existing = await q.findOne({ where: { tag: ownerId, locale } });
      if (existing) await q.update({ where: { id: existing.id }, data: { name } });
      else await q.create({ data: { tag: ownerId, locale, name } });
    }
  };

  const createTag = async (input: NamedInput): Promise<{ id: number }> => {
    const defaultLocale = await getDefaultLocale();
    const key = await validateTag(null, input, defaultLocale);
    const id: number = await strapi.db.transaction(async () => {
      const created = await strapi.db.query(uids().tag).create({ data: { key } });
      await saveTagTranslations(created.id, input.translations);
      return created.id;
    });
    return { id };
  };

  const updateTag = async (id: number, input: NamedInput): Promise<void> => {
    const found = await strapi.db.query(uids().tag).findOne({ where: { id } });
    if (!found) throw new EcommerceNotFoundError('tag not found');
    const defaultLocale = await getDefaultLocale();
    const key = await validateTag(id, input, defaultLocale);
    await strapi.db.transaction(async () => {
      if (key !== found.key) await strapi.db.query(uids().tag).update({ where: { id }, data: { key } });
      await saveTagTranslations(id, input.translations);
    });
  };

  const deleteTag = async (id: number): Promise<void> => {
    const found = await strapi.db.query(uids().tag).findOne({ where: { id } });
    if (!found) throw new EcommerceNotFoundError('tag not found');
    const inUse = await collectionsReferencing('tagIds', id);
    if (inUse.length) invalid(inUse, 'Invalid tag');
    await strapi.db.transaction(async () => {
      await unlinkTagProducts(id);
      await strapi.db.query(uids().tagTranslation).deleteMany({ where: { tag: id } });
      await strapi.db.query(uids().tag).delete({ where: { id } });
    });
  };

  /** The id of the entity whose key matches `name`, creating it (default-locale name) when absent. */
  const ensureTag = async (name: string): Promise<number> => {
    const key = nameKey(name);
    if (!key) invalid([{ path: 'name', code: 'required' }], 'Invalid tag');
    const q = strapi.db.query(uids().tag);
    const existing = await q.findOne({ where: { key } });
    if (existing) return existing.id;
    const defaultLocale = await getDefaultLocale();
    const created = await q.create({ data: { key } });
    await saveTagTranslations(created.id, { [defaultLocale]: { name } });
    return created.id;
  };

  return {
    // ---------------------------------------------------------------- categories

    async listCategoryTree(locale?: string): Promise<CategoryTreeNode[]> {
      const defaultLocale = await getDefaultLocale();
      const wanted = locale || defaultLocale;
      const [rows, counts] = await Promise.all([loadCategories(), productCounts()]);
      const byId = new Map<number, CategoryTreeNode>();
      for (const r of rows) {
        byId.set(r.id, {
          id: r.id,
          parentId: r.parent?.id ?? null,
          position: r.position ?? 0,
          active: r.active !== false,
          name: pickName(r.translations, wanted, defaultLocale),
          slug: pickName(r.translations, wanted, defaultLocale, 'slug'),
          productCount: counts.get(r.id) ?? 0,
          children: [],
        });
      }
      const roots: CategoryTreeNode[] = [];
      const order = (a: CategoryTreeNode, b: CategoryTreeNode) => a.position - b.position || a.id - b.id;
      for (const node of [...byId.values()].sort(order)) {
        const parent = node.parentId === null ? undefined : byId.get(node.parentId);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      return roots;
    },

    async getCategory(id: number): Promise<CategoryDetail> {
      const u = uids();
      const r = await strapi.db.query(u.category).findOne({
        where: { id },
        populate: { translations: true, parent: true },
      });
      if (!r) throw new EcommerceNotFoundError('Category not found');
      const translations: CategoryDetail['translations'] = {};
      for (const t of r.translations ?? []) {
        translations[t.locale] = {
          name: t.name,
          slug: t.slug,
          description: t.description ?? null,
          seoTitle: t.seoTitle ?? null,
          seoDescription: t.seoDescription ?? null,
        };
      }
      const [productCount, childCount] = await Promise.all([
        strapi.db.query(u.product).count({ where: { category: { id } } }),
        strapi.db.query(u.category).count({ where: { parent: { id } } }),
      ]);
      return {
        id: r.id,
        parentId: r.parent?.id ?? null,
        position: r.position ?? 0,
        active: r.active !== false,
        translations,
        productCount,
        childCount,
      };
    },

    async createCategory(input: CategoryInput): Promise<{ id: number }> {
      const defaultLocale = await getDefaultLocale();
      const errors = await validateCategoryInput(input, defaultLocale);
      const nodes = toNodes(await loadCategories());
      errors.push(...validateParent(nodes, null, input?.parentId));
      if (errors.length) invalid(errors, 'Invalid category');
      const parentId = input.parentId ?? null;
      const id: number = await strapi.db.transaction(async () => {
        const created = await strapi.db.query(uids().category).create({
          data: {
            parent: parentId,
            position: siblingsOf(nodes, parentId).length,
            active: input.active,
          },
        });
        await saveCategoryTranslations(created.id, input.translations);
        return created.id;
      });
      return { id };
    },

    /** A parent change places the category last among its new siblings. */
    async updateCategory(id: number, input: CategoryInput): Promise<void> {
      const defaultLocale = await getDefaultLocale();
      const nodes = toNodes(await loadCategories());
      const self = nodes.find((n) => n.id === id);
      if (!self) throw new EcommerceNotFoundError('Category not found');
      const errors = await validateCategoryInput(input, defaultLocale);
      const parentId = input?.parentId ?? null;
      const moved = parentId !== self.parentId;
      if (moved) errors.push(...validateParent(nodes, id, parentId));
      if (errors.length) invalid(errors, 'Invalid category');
      await strapi.db.transaction(async () => {
        await strapi.db.query(uids().category).update({
          where: { id },
          data: { active: input.active },
        });
        if (moved) {
          await writeOrder([...siblingsOf(nodes, parentId, id), self], parentId);
          await writeOrder(siblingsOf(nodes, self.parentId, id), self.parentId);
        }
        await saveCategoryTranslations(id, input.translations);
      });
      if (moved) await recalculateCategoryConditions();
    },

    async moveCategory(id: number, body: { parentId: number | null; position: number }): Promise<void> {
      const nodes = toNodes(await loadCategories());
      const self = nodes.find((n) => n.id === id);
      if (!self) throw new EcommerceNotFoundError('Category not found');
      const parentId = body?.parentId ?? null;
      const position = body?.position;
      const errors: ValidationIssue[] = [];
      if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
        errors.push({ path: 'position', code: 'invalid_number' });
      }
      if (parentId === id) errors.push({ path: 'parentId', code: 'CATEGORY_CYCLE' });
      else errors.push(...validateParent(nodes, id, parentId));
      if (errors.length) invalid(errors, 'Invalid category');

      await strapi.db.transaction(async () => {
        const siblings = siblingsOf(nodes, parentId, id);
        const at = Math.min(position, siblings.length);
        await writeOrder([...siblings.slice(0, at), self, ...siblings.slice(at)], parentId);
        if (parentId !== self.parentId) await writeOrder(siblingsOf(nodes, self.parentId, id), self.parentId);
      });
      await recalculateCategoryConditions();
    },

    /** Refused with subcategories or when an automated collection uses it; its products lose it. */
    async deleteCategory(id: number): Promise<void> {
      const u = uids();
      const nodes = toNodes(await loadCategories());
      const self = nodes.find((n) => n.id === id);
      if (!self) throw new EcommerceNotFoundError('Category not found');
      if (nodes.some((n) => n.parentId === id)) {
        invalid([{ path: 'children', code: 'CATEGORY_HAS_CHILDREN' }], 'Invalid category');
      }
      const inUse = await collectionsReferencing('categoryIds', id);
      if (inUse.length) invalid(inUse, 'Invalid category');
      const unlinked: number = await strapi.db.transaction(async () => {
        const products: any[] = await strapi.db
          .query(u.product)
          .findMany({ where: { category: { id } }, select: ['id'] });
        for (const p of products) {
          await strapi.db.query(u.product).update({ where: { id: p.id }, data: { category: null } });
        }
        await strapi.db.query(u.categoryTranslation).deleteMany({ where: { category: id } });
        await strapi.db.query(u.category).delete({ where: { id } });
        await writeOrder(siblingsOf(nodes, self.parentId, id), self.parentId);
        return products.length;
      });
      // Category conditions match whole subtrees: products leaving this category may leave an
      // ancestor's automated collection.
      if (unlinked > 0) await recalculateCategoryConditions();
    },

    // ---------------------------------------------------------------- tags

    listTags,
    createTag,
    updateTag,
    deleteTag,
    /** Ids for these names in order, deduplicated by normalized name; blanks skipped; missing created. */
    async ensureTags(names: string[]): Promise<number[]> {
      const seen = new Set<string>();
      const ids: number[] = [];
      for (const name of Array.isArray(names) ? names : []) {
        const key = typeof name === 'string' ? nameKey(name) : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const id = await ensureTag(name);
        if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    },
  };
};

export default EcommerceOrganizationService;
