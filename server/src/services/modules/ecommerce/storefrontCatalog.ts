import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { sanitizeSearchTerm } from './domain/storefront/request';
import { galleryCover, sortGallery } from './domain/galleryImages';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { categoryPath, subtreeIds } from './domain/organization';
import { COLLECTION_SORTS, sortEntries, type CollectionSort } from './domain/collections';

/** Image exactly as stored by the upload provider. `alt` is the product name (no `alt` column exists). */
export type PublicImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
  /** The gallery's cover (one per gallery); see galleryCover. */
  cover: boolean;
};

export type PublicCategoryRef = { id: number; name: string; slug: string };

/** The product's category with its breadcrumb (root first, the category last). */
export type PublicProductCategory = PublicCategoryRef & { path: PublicCategoryRef[] };

export type PublicNamed = { id: number; name: string };

/** Fields every product answer gains with the product organization. */
type PublicOrganization = {
  /** null without a category, or when it (or an ancestor) is inactive. */
  category: PublicProductCategory | null;
  productType: PublicNamed | null;
  tags: PublicNamed[];
};

export type PublicProductListItem = PublicOrganization & {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  image: PublicImage | null;
  priceMin: number;
  priceMax: number;
  /** Compare-at of the lowest-priced active variant, only when above its price. */
  compareAtPriceMin: number | null;
  currency: 'EUR';
  available: boolean;
};

export type PublicVariant = {
  id: number;
  option: string;
  sku: string;
  /** VAT-inclusive cents. */
  price: number;
  /** VAT-inclusive cents; only when above `price`, else null. */
  compareAtPrice: number | null;
  /** VAT rate in percent, as stored. */
  taxRate: number;
  available: boolean;
  images: PublicImage[];
};

export type PublicProduct = PublicOrganization & {
  id: number;
  slug: string;
  slugs: Record<string, string>;
  name: string;
  shortDescription: string;
  /** HTML restricted to the sanitizer allow-list (sanitised on save). */
  description: string;
  images: PublicImage[];
  currency: 'EUR';
  priceMin: number;
  priceMax: number;
  compareAtPriceMin: number | null;
  available: boolean;
  variants: PublicVariant[];
};

type Pagination = { page: number; pageSize: number; total: number; pageCount: number };

export type PublicProductPage = {
  results: PublicProductListItem[];
  pagination: Pagination;
};

/** A node of the active category tree. */
export type PublicCategory = {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  position: number;
  children: PublicCategory[];
};

export type PublicCategoryDetail = Omit<PublicCategory, 'children'> & {
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Breadcrumb: root first, this category last. */
  path: PublicCategoryRef[];
};

/** Never carries the collection's type, match, conditions or sort order. */
export type PublicCollection = {
  id: number;
  title: string;
  handle: string;
  description: string;
  image: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type PublicCollectionPage = { results: PublicCollection[]; pagination: Pagination };

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const SORTS = ['newest', 'oldest', 'price_asc', 'price_desc', 'name_asc', 'name_desc', 'best_selling'] as const;
type StorefrontSort = (typeof SORTS)[number];
const SORT_ORDER: Record<StorefrontSort, CollectionSort> = {
  newest: 'NEWEST',
  oldest: 'OLDEST',
  price_asc: 'PRICE_ASC',
  price_desc: 'PRICE_DESC',
  name_asc: 'TITLE_ASC',
  name_desc: 'TITLE_DESC',
  best_selling: 'BEST_SELLING',
};
const MAX_TAG_FILTER = 50;
const MAX_TEXT_FILTER = 255;

const bad = (path: string, code: string): never => {
  throw new EcommerceValidationError('Invalid request', [{ path, code }]);
};

const intParam = (raw: unknown, path: string, def: number, min: number, max: number): number => {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    return bad(path, 'invalid_number');
  }
  return n;
};

const isBlank = (raw: unknown) => raw === undefined || raw === null || raw === '';

/** A positive integer id, or null when absent. */
const idParam = (raw: unknown, path: string): number | null => {
  if (isBlank(raw)) return null;
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d{1,9}$/.test(text.trim()) || Number(text) < 1) {
    return bad(path, 'invalid');
  }
  return Number(text);
};

/** Comma-separated positive integer ids (deduplicated), or null when absent. */
const idListParam = (raw: unknown, path: string): number[] | null => {
  if (isBlank(raw)) return null;
  if (typeof raw !== 'string') return bad(path, 'invalid');
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length > MAX_TAG_FILTER || parts.some((part) => !/^\d{1,9}$/.test(part) || Number(part) < 1)) {
    return bad(path, 'invalid');
  }
  return [...new Set(parts.map(Number))];
};

/** A trimmed string, or null when absent or blank. */
const textParam = (raw: unknown, path: string): string | null => {
  if (isBlank(raw)) return null;
  if (typeof raw !== 'string' || raw.length > MAX_TEXT_FILTER) return bad(path, 'invalid');
  return raw.trim() || null;
};

const byPosition = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;

const EcommerceStorefrontCatalogService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const locales = () => strapi.plugin('i18n').service('locales');

  const pickText = (
    rows: any[] | undefined,
    locale: string,
    defaultLocale: string,
    field: string
  ): string => {
    const list = rows ?? [];
    const hit =
      list.find((t) => t.locale === locale && typeof t[field] === 'string' && t[field] !== '') ??
      list.find((t) => t.locale === defaultLocale && typeof t[field] === 'string');
    return hit ? hit[field] : '';
  };

  const nameOf = (p: any, locale: string, defaultLocale: string): string =>
    pickText(p.translations, locale, defaultLocale, 'name');

  /** The gallery in the admin's order, its cover flagged. */
  const toImages = (rows: any[] | undefined, alt: string): PublicImage[] => {
    const coverId = galleryCover(rows)?.id ?? null;
    return sortGallery(rows).map((i) => ({
      url: i.url,
      width: i.width,
      height: i.height,
      alt,
      cover: i.id === coverId,
    }));
  };
  const coverOf = (images: PublicImage[]): PublicImage | undefined =>
    images.find((i) => i.cover) ?? images[0];

  const activeVariants = (p: any): any[] =>
    [...(p.variants ?? [])].filter((v) => v.active).sort(byPosition);

  /** The stored compare-at price, only when it is above the price. */
  const compareAtOf = (v: any): number | null =>
    typeof v.compareAtPrice === 'number' && v.compareAtPrice > v.price ? v.compareAtPrice : null;

  /** `vs` are the active variants, in position order. */
  const summary = (vs: any[]) => {
    const prices = vs.map((v) => v.price as number);
    // The first (by position) of the lowest-priced variants.
    const cheapest = vs.reduce((min, v) => (v.price < min.price ? v : min), vs[0]);
    return {
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      compareAtPriceMin: compareAtOf(cheapest),
      available: vs.some((v) => (v.stock ?? 0) > 0),
    };
  };

  // ---- Categories ------------------------------------------------------------------------

  type CategoryNodeRow = {
    id: number;
    parentId: number | null;
    position: number;
    active: boolean;
    translations: any[];
  };

  /** Every category (active or not): the tree is small and is walked in memory. */
  const loadCategories = async (): Promise<CategoryNodeRow[]> => {
    const rows: any[] = await strapi.db.query(uids().category).findMany({
      select: ['id', 'position', 'active'],
      populate: {
        parent: { select: ['id'] },
        translations: { select: ['locale', 'name', 'slug'] },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent?.id ?? null,
      position: r.position ?? 0,
      active: r.active !== false,
      translations: r.translations ?? [],
    }));
  };

  /** Active, and every ancestor active. */
  const isVisible = (nodes: CategoryNodeRow[], id: number): boolean => {
    const map = new Map(nodes.map((n) => [n.id, n]));
    const path = categoryPath(nodes, id);
    return path.length > 0 && path.every((pid) => map.get(pid)?.active === true);
  };

  const categoryRef = (node: CategoryNodeRow, locale: string, defaultLocale: string): PublicCategoryRef => ({
    id: node.id,
    name: pickText(node.translations, locale, defaultLocale, 'name'),
    slug: slugFor(node, locale, defaultLocale),
  });

  const breadcrumb = (nodes: CategoryNodeRow[], id: number, locale: string, defaultLocale: string) => {
    const map = new Map(nodes.map((n) => [n.id, n]));
    return categoryPath(nodes, id).map((pid) => categoryRef(map.get(pid)!, locale, defaultLocale));
  };

  /** Slug in the request locale, then the default locale; unknown or hidden -> 404. */
  const resolveCategory = (
    nodes: CategoryNodeRow[],
    slug: string,
    locale: string,
    defaultLocale: string
  ): CategoryNodeRow => {
    let found: CategoryNodeRow | undefined;
    for (const l of locale === defaultLocale ? [locale] : [locale, defaultLocale]) {
      found = nodes.find((n) => n.translations.some((t) => t.locale === l && t.slug === slug));
      if (found) break;
    }
    if (!found || !isVisible(nodes, found.id)) throw new EcommerceNotFoundError('Category not found');
    return found;
  };

  const productCategory = (
    nodes: CategoryNodeRow[],
    id: number | null | undefined,
    locale: string,
    defaultLocale: string
  ): PublicProductCategory | null => {
    const node = id ? nodes.find((n) => n.id === id) : undefined;
    if (!node || !isVisible(nodes, node.id)) return null;
    return { ...categoryRef(node, locale, defaultLocale), path: breadcrumb(nodes, node.id, locale, defaultLocale) };
  };

  // ---- Collections -----------------------------------------------------------------------

  const toCollection = (row: any, locale: string, defaultLocale: string): PublicCollection => ({
    id: row.id,
    title: pickText(row.translations, locale, defaultLocale, 'title'),
    handle: pickHandle(row.translations, locale) || pickHandle(row.translations, defaultLocale),
    description: pickText(row.translations, locale, defaultLocale, 'description'),
    image: typeof row.image === 'string' && row.image ? row.image : null,
    seoTitle: pickText(row.translations, locale, defaultLocale, 'seoTitle') || null,
    seoDescription: pickText(row.translations, locale, defaultLocale, 'seoDescription') || null,
  });
  const pickHandle = (rows: any[] | undefined, locale: string): string =>
    (rows ?? []).find((t) => t.locale === locale && t.handle)?.handle ?? '';

  /** Active collection by handle in the request locale, then the default locale; else 404. */
  const findCollection = async (handle: string, locale: string, defaultLocale: string): Promise<any> => {
    for (const l of locale === defaultLocale ? [locale] : [locale, defaultLocale]) {
      const row = await strapi.db.query(uids().collection).findOne({
        where: { active: true, translations: { locale: l, handle } },
        select: ['id', 'sortOrder', 'image'],
        populate: { translations: true },
      });
      if (row) return row;
    }
    throw new EcommerceNotFoundError('Collection not found');
  };

  // ---- Product organization fields ----------------------------------------------------------

  const organizationOf = (
    p: any,
    nodes: CategoryNodeRow[],
    locale: string,
    defaultLocale: string
  ): PublicOrganization => {
    const named = (row: any): PublicNamed => ({
      id: row.id,
      name: pickText(row.translations, locale, defaultLocale, 'name'),
    });
    return {
      category: productCategory(nodes, p.category?.id, locale, defaultLocale),
      productType: p.productType ? named(p.productType) : null,
      tags: (p.tags ?? [])
        .map(named)
        .sort((a: PublicNamed, b: PublicNamed) => a.name.localeCompare(b.name, locale) || a.id - b.id),
    };
  };
  const ORGANIZATION_POPULATE = {
    category: { select: ['id'] },
    productType: { select: ['id'], populate: { translations: { select: ['locale', 'name'] } } },
    tags: { select: ['id'], populate: { translations: { select: ['locale', 'name'] } } },
  };

  /** Dedupes rows a join on a to-many relation may repeat. */
  const unique = (rows: any[]): any[] => [...new Map(rows.map((r) => [r.id, r])).values()];

  const slugFor = (p: any, locale: string, defaultLocale: string): string =>
    pickSlug(p.translations, locale) || pickSlug(p.translations, defaultLocale);
  const pickSlug = (rows: any[] | undefined, locale: string): string =>
    (rows ?? []).find((t) => t.locale === locale && t.slug)?.slug ?? '';

  return {
    /** Empty -> default locale; a locale not configured in i18n -> 400 `invalid_locale`. */
    async resolveLocale(raw: unknown): Promise<string> {
      const defaultLocale: string = await locales().getDefaultLocale();
      if (raw === undefined || raw === null || raw === '') return defaultLocale;
      const all: { code: string }[] = await locales().find();
      if (typeof raw !== 'string' || !all.some((l) => l.code === raw)) {
        return bad('locale', 'invalid_locale');
      }
      return raw;
    },

    async listProducts(q: {
      page?: unknown;
      pageSize?: unknown;
      search?: unknown;
      sort?: unknown;
      /** Category slug: the category and its whole subtree. */
      category?: unknown;
      /** Collection handle. */
      collection?: unknown;
      /** Product type id. */
      type?: unknown;
      /** Comma-separated tag ids: a product with any of them matches. */
      tag?: unknown;
      locale: string;
    }): Promise<PublicProductPage> {
      const u = uids();
      const page = intParam(q.page, 'page', 1, 1, 1_000_000);
      const pageSize = intParam(q.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
      const sort = isBlank(q.sort) ? null : q.sort;
      if (sort !== null && (typeof sort !== 'string' || !(SORTS as readonly string[]).includes(sort))) {
        bad('sort', 'invalid_sort');
      }
      const categorySlug = textParam(q.category, 'category');
      const collectionHandle = textParam(q.collection, 'collection');
      const typeId = idParam(q.type, 'type');
      const tagIds = idListParam(q.tag, 'tag');
      // `sanitizeSearchTerm` strips `%`, `_` and `\`, so an underscore typed in the search is
      // dropped: a SKU such as `AB_1` is found by `AB1`-style fragments, not by the underscore.
      const search = sanitizeSearchTerm(q.search);
      const defaultLocale: string = await locales().getDefaultLocale();

      const where: any = { active: true, variants: { active: true } };
      if (search) {
        where.$or = [
          { translations: { name: { $containsi: search } } },
          { variants: { sku: { $containsi: search }, active: true } },
        ];
      }
      let nodes: CategoryNodeRow[] | null = null;
      if (categorySlug) {
        nodes = await loadCategories();
        const category = resolveCategory(nodes, categorySlug, q.locale, defaultLocale);
        // The whole subtree, whatever the subcategories' activity (as the collection conditions).
        where.category = { id: { $in: subtreeIds(nodes, category.id) } };
      }
      const collection = collectionHandle
        ? await findCollection(collectionHandle, q.locale, defaultLocale)
        : null;
      if (collection) where.collectionMembers = { collection: { id: collection.id } };
      if (typeId !== null) where.productType = { id: typeId };
      if (tagIds) where.tags = { id: { $in: tagIds } };

      // An explicit sort wins; with a collection, its own sort order; else newest.
      const order: CollectionSort = sort
        ? SORT_ORDER[sort as StorefrontSort]
        : collection && (COLLECTION_SORTS as readonly string[]).includes(collection.sortOrder)
          ? collection.sortOrder
          : collection
            ? 'MANUAL'
            : 'NEWEST';

      const rows: any[] = unique(
        await strapi.db.query(u.product).findMany({
          where,
          orderBy: { id: 'desc' },
          // Only what the list view needs: no descriptions, no variant dimensions.
          populate: {
            translations: { select: ['locale', 'name', 'slug', 'shortDescription'] },
            variants: { select: ['price', 'compareAtPrice', 'tax', 'active', 'stock', 'position'] },
          },
        })
      ).filter((p) => activeVariants(p).length > 0);

      const positions = new Map<number, number>();
      if (order === 'MANUAL' && collection) {
        const members: any[] = await strapi.db.query(u.collectionProduct).findMany({
          where: { collection: { id: collection.id } },
          select: ['position'],
          populate: { product: { select: ['id'] } },
        });
        for (const m of members) if (m.product?.id) positions.set(m.product.id, m.position ?? 0);
      }
      const sold: Map<number, number> =
        order === 'BEST_SELLING' && rows.length
          ? await strapi
              .plugin(PLUGIN_ID)
              .service('EcommerceCollectionService')
              .unitsSoldByProduct(rows.map((p) => p.id))
          : new Map();

      const entries = sortEntries(
        rows.map((p) => ({
          id: p.id as number,
          p,
          name: nameOf(p, q.locale, defaultLocale),
          unitsSold: sold.get(p.id) ?? 0,
          position: positions.get(p.id) ?? Number.MAX_SAFE_INTEGER,
          ...summary(activeVariants(p)),
        })),
        order,
        q.locale
      );

      const total = entries.length;
      const slice = entries.slice((page - 1) * pageSize, page * pageSize);

      // Images are loaded only for the page being returned.
      const withImages: any[] = slice.length
        ? await strapi.db.query(u.product).findMany({
            where: { id: { $in: slice.map((e) => e.p.id) } },
            populate: {
              images: true,
              variants: { populate: { images: true } },
              ...ORGANIZATION_POPULATE,
            },
          })
        : [];
      const imagesById = new Map(withImages.map((p) => [p.id, p]));
      if (!nodes && withImages.some((p) => p.category)) nodes = await loadCategories();

      const results: PublicProductListItem[] = slice.map((e) => {
        const full = imagesById.get(e.p.id);
        // The list shows the product's cover, else the first active variant's.
        const productImage = coverOf(toImages(full?.images, e.name));
        const variantImage = activeVariants(full ?? {})
          .map((v) => coverOf(toImages(v.images, e.name)))
          .find(Boolean);
        return {
          id: e.p.id,
          slug: slugFor(e.p, q.locale, defaultLocale),
          name: e.name,
          shortDescription: pickText(e.p.translations, q.locale, defaultLocale, 'shortDescription'),
          image: productImage ?? variantImage ?? null,
          priceMin: e.priceMin,
          priceMax: e.priceMax,
          compareAtPriceMin: e.compareAtPriceMin,
          currency: 'EUR',
          available: e.available,
          ...organizationOf(full ?? e.p, nodes ?? [], q.locale, defaultLocale),
        };
      });

      return {
        results,
        pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
      };
    },

    /** The slug is looked up in the requested locale, then in the default locale. */
    async getProduct(slug: string, locale: string): Promise<PublicProduct> {
      const u = uids();
      const defaultLocale: string = await locales().getDefaultLocale();
      const populate = {
        translations: true,
        images: true,
        variants: { populate: { translations: true, images: true } },
        ...ORGANIZATION_POPULATE,
      };
      let found: any = null;
      if (typeof slug === 'string' && slug) {
        for (const l of locale === defaultLocale ? [locale] : [locale, defaultLocale]) {
          found = await strapi.db.query(u.product).findOne({
            where: { active: true, translations: { locale: l, slug } },
            populate,
          });
          if (found) break;
        }
      }
      const vs = found ? activeVariants(found) : [];
      if (!found || !vs.length) throw new EcommerceNotFoundError('Product not found');

      const name = nameOf(found, locale, defaultLocale);
      const images = toImages(found.images, name);
      const slugs: Record<string, string> = {};
      for (const t of found.translations ?? []) if (t.slug) slugs[t.locale] = t.slug;
      const nodes = found.category ? await loadCategories() : [];

      return {
        id: found.id,
        slug: slugFor(found, locale, defaultLocale),
        slugs,
        name,
        shortDescription: pickText(found.translations, locale, defaultLocale, 'shortDescription'),
        description: pickText(found.translations, locale, defaultLocale, 'description'),
        images,
        currency: 'EUR',
        ...summary(vs),
        ...organizationOf(found, nodes, locale, defaultLocale),
        variants: vs.map((v) => {
          const own = toImages(v.images, name);
          return {
            id: v.id,
            option: pickText(v.translations, locale, defaultLocale, 'option'),
            sku: v.sku,
            price: v.price,
            compareAtPrice: compareAtOf(v),
            taxRate: v.tax,
            available: (v.stock ?? 0) > 0,
            images: own.length ? own : images,
          };
        }),
      };
    },

    /** The active category tree: an inactive category hides its whole subtree. */
    async listCategories(locale: string): Promise<PublicCategory[]> {
      const defaultLocale: string = await locales().getDefaultLocale();
      const nodes = await loadCategories();
      const children = new Map<number | null, CategoryNodeRow[]>();
      for (const n of nodes) {
        if (!n.active) continue;
        const list = children.get(n.parentId) ?? [];
        list.push(n);
        children.set(n.parentId, list);
      }
      const seen = new Set<number>();
      const build = (parentId: number | null): PublicCategory[] =>
        [...(children.get(parentId) ?? [])]
          .filter((n) => !seen.has(n.id))
          .sort(byPosition)
          .map((n) => {
            seen.add(n.id);
            return {
              ...categoryRef(n, locale, defaultLocale),
              parentId: n.parentId,
              position: n.position,
              children: build(n.id),
            };
          });
      return build(null);
    },

    /** Slug in the request locale, then the default locale; unknown, inactive or under an inactive ancestor -> 404. */
    async getCategory(slug: string, locale: string): Promise<PublicCategoryDetail> {
      const defaultLocale: string = await locales().getDefaultLocale();
      const nodes = await loadCategories();
      const node = resolveCategory(nodes, typeof slug === 'string' ? slug : '', locale, defaultLocale);
      const texts: any[] = await strapi.db.query(uids().categoryTranslation).findMany({
        where: { category: { id: node.id } },
        select: ['locale', 'description', 'seoTitle', 'seoDescription'],
      });
      return {
        ...categoryRef(node, locale, defaultLocale),
        parentId: node.parentId,
        position: node.position,
        description: pickText(texts, locale, defaultLocale, 'description'),
        seoTitle: pickText(texts, locale, defaultLocale, 'seoTitle') || null,
        seoDescription: pickText(texts, locale, defaultLocale, 'seoDescription') || null,
        path: breadcrumb(nodes, node.id, locale, defaultLocale),
      };
    },

    /** Active collections by title in the request locale (default-locale fallback). */
    async listCollections(q: { page?: unknown; pageSize?: unknown; locale: string }): Promise<PublicCollectionPage> {
      const page = intParam(q.page, 'page', 1, 1, 1_000_000);
      const pageSize = intParam(q.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
      const defaultLocale: string = await locales().getDefaultLocale();
      const rows: any[] = await strapi.db.query(uids().collection).findMany({
        where: { active: true },
        select: ['id', 'image'],
        populate: { translations: true },
      });
      const all = rows
        .map((r) => toCollection(r, q.locale, defaultLocale))
        .sort((a, b) => a.title.localeCompare(b.title, q.locale) || a.id - b.id);
      return {
        results: all.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: all.length, pageCount: Math.ceil(all.length / pageSize) },
      };
    },

    /** Handle in the request locale, then the default locale; unknown or inactive -> 404. */
    async getCollection(handle: string, locale: string): Promise<PublicCollection> {
      const defaultLocale: string = await locales().getDefaultLocale();
      if (typeof handle !== 'string' || !handle) throw new EcommerceNotFoundError('Collection not found');
      return toCollection(await findCollection(handle, locale, defaultLocale), locale, defaultLocale);
    },
  };
};

export default EcommerceStorefrontCatalogService;
