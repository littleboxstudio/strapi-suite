import { randomUUID } from 'crypto';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  FieldError,
  ProductInput,
  isBlank,
  VariantInput,
  resolveUniqueSlug,
  sanitizeDescription,
  slugify,
  validateProductInput,
} from './domain/catalog';
import type { ImageRecord, StoredImage } from './images';
import { galleryCover, sortGallery } from './domain/galleryImages';
import type { StockMoveInput } from './stock';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { categoryPath, subtreeIds, type CategoryNode } from './domain/organization';

const PAGE_SIZE = 50 as const;

/** The client's idempotency key when it looks sane, else a fresh one. */
const adjustmentKey = (key: unknown): string =>
  typeof key === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(key) ? key : randomUUID();

export type ProductListItem = {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  skus: string[];
  priceMin: number;
  priceMax: number;
  stockTotal: number;
  variantCount: number;
  hasNegativeStock: boolean;
  active: boolean;
};

export type ProductListFilters = {
  /** The category or any of its subcategories. */
  categoryId?: number;
  productTypeId?: number;
  tagId?: number;
  /** Exact, case-insensitive (surrounding spaces ignored). */
  vendor?: string;
  collectionId?: number;
};

export type ProductDetail = Omit<
  ProductInput,
  'variants' | 'vendor' | 'categoryId' | 'productTypeId' | 'productTypeName' | 'tagIds' | 'tagNames' | 'collectionIds'
> & {
  id: number;
  images: ImageRecord[];
  /** False once any order (in any state) has a line with this product: it can only be deactivated. */
  deletable: boolean;
  vendor: string | null;
  categoryId: number | null;
  /** Root first, names in the default locale. */
  categoryPath: { id: number; name: string }[];
  productTypeId: number | null;
  productTypeName: string | null;
  tags: { id: number; name: string }[];
  /** Manual and automated collections the product is in. */
  collections: { id: number; title: string; type: 'MANUAL' | 'AUTOMATED' }[];
  variants: (VariantInput & {
    id: number;
    images: ImageRecord[];
    deletable: boolean;
    compareAtPrice: number | null;
  })[];
};

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Text in the default locale, else any. */
const pickText = (translations: any[] = [], defaultLocale: string, field = 'name'): string =>
  translations.find((t) => t.locale === defaultLocale)?.[field] ?? translations[0]?.[field] ?? '';

const cleanVendor = (vendor: string | null | undefined): string | null =>
  typeof vendor === 'string' && vendor.trim() ? vendor.trim() : null;

const toImage = (r: any, coverId: number | null): ImageRecord => ({
  id: r.id,
  name: r.name,
  width: r.width,
  height: r.height,
  sizeBytes: r.sizeBytes,
  url: r.url,
  position: r.position,
  cover: r.id === coverId,
});

/** The gallery in order, with its cover (the marked image, else the first) flagged. */
const sortImages = (images: any[] = []): ImageRecord[] => {
  const coverId = galleryCover(images)?.id ?? null;
  return sortGallery(images).map((r) => toImage(r, coverId));
};

const EcommerceProductService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const locales = () => strapi.plugin('i18n').service('locales');
  const images = (): { removeFiles(records: StoredImage[]): Promise<void> } =>
    strapi.plugin(PLUGIN_ID).service('EcommerceImageService');
  const stock = (): { move(input: StockMoveInput): Promise<{ applied: boolean }> } =>
    strapi.plugin(PLUGIN_ID).service('EcommerceStockService');
  const organization = (): {
    ensureProductType(name: string): Promise<number>;
    ensureTags(names: string[]): Promise<number[]>;
  } => strapi.plugin(PLUGIN_ID).service('EcommerceOrganizationService');

  /**
   * Re-evaluates the product against the automated collections, after the change is committed.
   * A failure never undoes the change: the collections' Recalculate button repairs memberships.
   */
  const syncCollections = async (productId: number) => {
    try {
      const collections: { syncProducts(ids: number[]): Promise<unknown> } =
        strapi.plugin(PLUGIN_ID).service('EcommerceCollectionService');
      await collections.syncProducts([productId]);
    } catch (e) {
      strapi.log?.warn?.(
        '[ecommerce] collection sync after a product change failed: ' + (e instanceof Error ? e.name : typeof e)
      );
    }
  };

  const loadCategoryNodes = async (): Promise<(CategoryNode & { translations: any[] })[]> => {
    const rows: any[] = await strapi.db.query(uids().category).findMany({
      populate: { parent: true, translations: true },
    });
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent?.id ?? null,
      position: r.position ?? 0,
      translations: r.translations ?? [],
    }));
  };

  /** Ids among `ids` with no row in `uid`. */
  const missingIds = async (uid: string, ids: number[]): Promise<Set<number>> => {
    if (!ids.length) return new Set();
    const found: { id: number }[] = await strapi.db
      .query(uid as any)
      .findMany({ where: { id: { $in: ids } }, select: ['id'] });
    const present = new Set(found.map((r) => r.id));
    return new Set(ids.filter((id) => !present.has(id)));
  };

  /** Existence of the referenced category, type, tags and (manual) collections. */
  const organizationErrors = async (input: ProductInput): Promise<FieldError[]> => {
    const u = uids();
    const errors: FieldError[] = [];
    if (isPositiveInt(input.categoryId) && (await missingIds(u.category, [input.categoryId])).size) {
      errors.push({ path: 'categoryId', code: 'unknown' });
    }
    if (isPositiveInt(input.productTypeId) && (await missingIds(u.productType, [input.productTypeId])).size) {
      errors.push({ path: 'productTypeId', code: 'unknown' });
    }
    if (Array.isArray(input.tagIds)) {
      const missing = await missingIds(u.tag, input.tagIds.filter(isPositiveInt));
      input.tagIds.forEach((id, i) => {
        if (missing.has(id)) errors.push({ path: `tagIds.${i}`, code: 'unknown' });
      });
    }
    if (Array.isArray(input.collectionIds)) {
      const ids = input.collectionIds.filter(isPositiveInt);
      const rows: { id: number; type: string }[] = ids.length
        ? await strapi.db.query(u.collection).findMany({ where: { id: { $in: ids } }, select: ['id', 'type'] })
        : [];
      const types = new Map(rows.map((r) => [r.id, r.type]));
      input.collectionIds.forEach((id, i) => {
        if (!isPositiveInt(id)) return;
        if (!types.has(id)) errors.push({ path: `collectionIds.${i}`, code: 'unknown' });
        else if (types.get(id) !== 'MANUAL') errors.push({ path: `collectionIds.${i}`, code: 'automated_collection' });
      });
    }
    return errors;
  };

  /**
   * The product's relation data for the fields present in `input` (omitted = unchanged on update;
   * on create every field is written, so omitted = empty). Names are resolved (created when new).
   */
  const organizationData = async (input: ProductInput, creating: boolean): Promise<Record<string, unknown>> => {
    const data: Record<string, unknown> = {};
    if (creating || input.vendor !== undefined) data.vendor = cleanVendor(input.vendor);
    if (creating || input.categoryId !== undefined) data.category = input.categoryId ?? null;

    if (input.productTypeId !== undefined) {
      data.productType = input.productTypeId ?? null;
    } else if (typeof input.productTypeName === 'string' && input.productTypeName.trim()) {
      data.productType = await organization().ensureProductType(input.productTypeName);
    } else if (creating || input.productTypeName === null) {
      data.productType = null;
    }

    const tagNames = Array.isArray(input.tagNames) ? input.tagNames.filter((n) => typeof n === 'string') : [];
    if (creating || input.tagIds !== undefined || tagNames.length) {
      const ids = [...(input.tagIds ?? [])];
      if (tagNames.length) ids.push(...(await organization().ensureTags(tagNames)));
      data.tags = { set: [...new Set(ids)] };
    }
    return data;
  };

  /**
   * Makes the product's MANUAL collection memberships exactly `collectionIds`. New members go last
   * (position max + 1); automated memberships are computed elsewhere and never touched here.
   */
  const syncManualCollections = async (productId: number, collectionIds: number[]) => {
    const u = uids();
    const q = strapi.db.query(u.collectionProduct);
    const wanted = new Set(collectionIds);
    const current: any[] = await q.findMany({
      where: { product: { id: productId } },
      populate: { collection: true },
    });
    const have = new Set<number>();
    for (const row of current) {
      const collection = row.collection;
      if (!collection || collection.type !== 'MANUAL') continue;
      if (wanted.has(collection.id)) have.add(collection.id);
      else await q.delete({ where: { id: row.id } });
    }
    for (const collectionId of wanted) {
      if (have.has(collectionId)) continue;
      const last: any[] = await q.findMany({
        where: { collection: { id: collectionId } },
        orderBy: { position: 'desc' },
        limit: 1,
        select: ['position'],
      });
      const position = last.length ? (last[0].position ?? 0) + 1 : 0;
      await q.create({
        data: { collection: collectionId, product: productId, position, uniqueKey: `${collectionId}:${productId}` },
      });
    }
  };

  const getDefaultLocale = async (): Promise<string> => locales().getDefaultLocale();

  /**
   * Which of these variants appear in an order line, and whether the product itself does. Any
   * order counts (cancelled and archived too): order lines, invoices and returns keep pointing at
   * them, so ordered products and variants are deactivated, never deleted.
   */
  const orderUsage = async (
    productId: number | null,
    variantIds: number[]
  ): Promise<{ product: boolean; variants: Set<number> }> => {
    const u = uids();
    const variants = new Set<number>();
    let product = false;
    if (productId !== null) {
      const byProduct: { variantId: number | null }[] = await strapi.db
        .query(u.orderLine)
        .findMany({ where: { productId }, select: ['variantId'] });
      product = byProduct.length > 0;
      byProduct.forEach((l) => l.variantId && variants.add(l.variantId));
    }
    if (variantIds.length) {
      const byVariant: { variantId: number }[] = await strapi.db
        .query(u.orderLine)
        .findMany({ where: { variantId: { $in: variantIds } }, select: ['variantId'] });
      byVariant.forEach((l) => variants.add(l.variantId));
      if (byVariant.length) product = true;
    }
    return { product, variants };
  };

  const getLocales = async (): Promise<{ code: string; name: string }[]> => {
    const all = await locales().find();
    return all.map((l: any) => ({ code: l.code, name: l.name }));
  };

  const save = async (
    productId: number | null,
    input: ProductInput,
    actor: string
  ): Promise<number> => {
    const u = uids();
    const defaultLocale = await getDefaultLocale();

    const errorList: FieldError[] = validateProductInput(input, defaultLocale);

    const variants = input.variants ?? [];
    const skus = variants.map((v) => (typeof v.sku === 'string' ? v.sku.trim() : ''));
    const nonEmpty = skus.filter(Boolean);
    if (nonEmpty.length) {
      const clashes: { sku: string }[] = await strapi.db.query(u.variant).findMany({
        where: {
          sku: { $in: nonEmpty },
          ...(productId ? { product: { id: { $ne: productId } } } : {}),
        },
      });
      const used = new Set(clashes.map((c) => c.sku));
      skus.forEach((sku, i) => {
        const path = `variants.${i}.sku`;
        if (sku && used.has(sku) && !errorList.some((e) => e.path === path)) {
          errorList.push({ path, code: 'duplicate_sku' });
        }
      });
    }

    // An omitted compare-at price keeps the stored one, which must still be above the new price.
    if (productId !== null) {
      const keptIds = variants
        .map((v) => (v.compareAtPrice === undefined && isPositiveInt(v.id) ? v.id : null))
        .filter((id): id is number => id !== null);
      const stored: { id: number; compareAtPrice: number | null }[] = keptIds.length
        ? await strapi.db.query(u.variant).findMany({
            where: { id: { $in: keptIds }, product: { id: productId } },
            select: ['id', 'compareAtPrice'],
          })
        : [];
      const caps = new Map(stored.map((r) => [r.id, r.compareAtPrice]));
      variants.forEach((v, i) => {
        const cap = v.id ? caps.get(v.id) : undefined;
        const path = `variants.${i}.compareAtPrice`;
        if (typeof cap === 'number' && typeof v.price === 'number' && cap <= v.price && !errorList.some((e) => e.path === path)) {
          errorList.push({ path, code: 'compare_at_not_above_price' });
        }
      });
    }

    if (!errorList.some((e) => /^(categoryId|productTypeId|tagIds|collectionIds)(\.|$)/.test(e.path))) {
      errorList.push(...(await organizationErrors(input)));
    }

    if (errorList.length) {
      throw new EcommerceValidationError('Invalid product', errorList);
    }

    if (productId !== null) {
      const found = await strapi.db.query(u.product).findOne({ where: { id: productId } });
      if (!found) throw new EcommerceNotFoundError('Product not found');
    }

    // Image files of removed variants are deleted only after the transaction commits.
    const removedImages: StoredImage[] = [];

    const savedId: number = await strapi.db.transaction(async () => {
      let id = productId;
      const organized = await organizationData(input, id === null);
      if (id === null) {
        const created = await strapi.db
          .query(u.product)
          .create({ data: { active: input.active, ...organized } });
        id = created.id as number;
      } else {
        await strapi.db
          .query(u.product)
          .update({ where: { id }, data: { active: input.active, ...organized } });
      }
      const ownerId = id as number;
      if (Array.isArray(input.collectionIds)) await syncManualCollections(ownerId, input.collectionIds);

      for (const [locale, t] of Object.entries(input.translations ?? {})) {
        // Validation guarantees a blank name here means the whole translation was cleared.
        if (isBlank(t?.name)) {
          await strapi.db
            .query(u.productTranslation)
            .deleteMany({ where: { product: ownerId, locale } });
          continue;
        }
        const data = {
          locale,
          name: t.name.trim(),
          shortDescription: t.shortDescription ?? '',
          description: sanitizeDescription(t.description ?? ''),
          product: ownerId,
        };
        const existing = await strapi.db
          .query(u.productTranslation)
          .findOne({ where: { product: ownerId, locale } });
        // The slug is stable: kept while the translation exists, generated only on creation
        // (or when the stored one is empty).
        if (existing?.slug) {
          await strapi.db
            .query(u.productTranslation)
            .update({ where: { id: existing.id }, data });
        } else {
          const taken: { slug: string }[] = await strapi.db.query(u.productTranslation).findMany({
            where: { locale, product: { id: { $ne: ownerId } } },
            select: ['slug'],
          });
          const slug = resolveUniqueSlug(
            slugify(t.name) || 'product',
            taken.map((r) => r.slug)
          );
          if (existing) {
            await strapi.db
              .query(u.productTranslation)
              .update({ where: { id: existing.id }, data: { ...data, slug } });
          } else {
            await strapi.db.query(u.productTranslation).create({ data: { ...data, slug } });
          }
        }
      }

      const current: { id: number }[] =
        productId === null
          ? []
          : await strapi.db.query(u.variant).findMany({ where: { product: ownerId } });
      const currentIds = new Set(current.map((v) => v.id));
      const keptIds = new Set(
        variants.map((v) => v.id).filter((id): id is number => !!id && currentIds.has(id))
      );

      // A variant that was ever ordered (any order state) cannot be deleted: the admin
      // deactivates it instead. Paths index the stored order.
      const ordered = [...current].sort(
        (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id
      );
      const removedIds = ordered.filter((v) => !keptIds.has(v.id)).map((v) => v.id);
      if (removedIds.length) {
        const { variants: inUse } = await orderUsage(null, removedIds);
        const blocked: FieldError[] = ordered
          .map((v, i) =>
            inUse.has(v.id) ? { path: `variants.${i}`, code: 'VARIANT_IN_ORDERS' } : null
          )
          .filter((e): e is FieldError => !!e);
        if (blocked.length) throw new EcommerceValidationError('Invalid product', blocked);
      }

      // A stock set from the admin is sent as a difference plus the stock the admin saw: if the
      // stock moved since (an order, another admin), applying the difference would miss the typed
      // value, so the save is refused. A replay of an already applied adjustment is not a change.
      const stockChanged: FieldError[] = [];
      for (let i = 0; i < variants.length; i += 1) {
        const v = variants[i];
        if (!v.id || !currentIds.has(v.id) || !v.stockAdjustment) continue;
        if (typeof v.stockExpected !== 'number') continue;
        const row: any = current.find((c) => c.id === v.id);
        if ((row?.stock ?? 0) === v.stockExpected) continue;
        const applied = await strapi.db.query(u.stockMovement).findOne({
          where: { operationKey: `adjust:${v.id}:${adjustmentKey(v.stockAdjustmentKey)}` },
        });
        if (!applied) stockChanged.push({ path: `variants.${i}.stock`, code: 'STOCK_CHANGED' });
      }
      if (stockChanged.length) throw new EcommerceValidationError('Invalid product', stockChanged);

      // Removed variants go first, so a new variant may reuse a removed one's SKU.
      for (const old of current) {
        if (keptIds.has(old.id)) continue;
        const imgs: StoredImage[] = await strapi.db
          .query(u.image)
          .findMany({ where: { variant: old.id } });
        if (imgs.length) {
          await strapi.db
            .query(u.image)
            .deleteMany({ where: { id: { $in: imgs.map((img) => img.id) } } });
          removedImages.push(...imgs);
        }
        await strapi.db.query(u.variantTranslation).deleteMany({ where: { variant: old.id } });
        await strapi.db.query(u.variant).delete({ where: { id: old.id } });
      }

      for (let i = 0; i < variants.length; i += 1) {
        const v = variants[i];
        // Stock is never written directly: it changes only through ledger movements.
        const data = {
          sku: skus[i],
          price: v.price,
          // Omitted on an existing variant = unchanged (callers that do not know the field).
          ...(v.compareAtPrice !== undefined || !(v.id && currentIds.has(v.id))
            ? { compareAtPrice: v.compareAtPrice ?? null }
            : {}),
          tax: v.tax,
          weight: v.weight,
          width: v.width,
          height: v.height,
          depth: v.depth,
          active: v.active,
          position: i,
          product: ownerId,
        };
        let variantId: number;
        if (v.id && currentIds.has(v.id)) {
          variantId = v.id;
          await strapi.db.query(u.variant).update({ where: { id: variantId }, data });
          if (v.stockAdjustment) {
            await stock().move(
              {
                variantId,
                quantity: v.stockAdjustment,
                type: 'MANUAL_ADJUST',
                operationKey: `adjust:${variantId}:${adjustmentKey(v.stockAdjustmentKey)}`,
                actor,
              }
            );
          }
        } else {
          const created = await strapi.db.query(u.variant).create({ data: { ...data, stock: 0 } });
          variantId = created.id;
          if (v.stock) {
            await stock().move(
              {
                variantId,
                quantity: v.stock,
                type: 'MANUAL_ADJUST',
                operationKey: `initial:${variantId}:${randomUUID()}`,
                reason: 'initial stock',
                actor,
              }
            );
          }
        }

        for (const [locale, vt] of Object.entries(v.translations ?? {})) {
          if (isBlank(vt?.option)) {
            await strapi.db
              .query(u.variantTranslation)
              .deleteMany({ where: { variant: variantId, locale } });
            continue;
          }
          const tData = { locale, option: vt.option.trim(), variant: variantId };
          const existing = await strapi.db
            .query(u.variantTranslation)
            .findOne({ where: { variant: variantId, locale } });
          if (existing) {
            await strapi.db
              .query(u.variantTranslation)
              .update({ where: { id: existing.id }, data: tData });
          } else {
            await strapi.db.query(u.variantTranslation).create({ data: tData });
          }
        }
      }

      return ownerId;
    });

    if (removedImages.length) await images().removeFiles(removedImages);
    await syncCollections(savedId);
    return savedId;
  };

  return {
    getDefaultLocale,
    getLocales,

    async list(params: { page: number; search?: string; locale?: string } & ProductListFilters) {
      const u = uids();
      const page = Math.max(1, params.page || 1);
      const search = params.search?.trim();
      const where: Record<string, any> = search
        ? {
            $or: [
              { translations: { name: { $containsi: search } } },
              { variants: { sku: { $containsi: search } } },
            ],
          }
        : {};
      if (isPositiveInt(params.categoryId)) {
        const nodes = await loadCategoryNodes();
        where.category = { id: { $in: subtreeIds(nodes, params.categoryId) } };
      }
      if (isPositiveInt(params.productTypeId)) where.productType = { id: params.productTypeId };
      if (isPositiveInt(params.tagId)) where.tags = { id: params.tagId };
      if (isPositiveInt(params.collectionId)) {
        where.collectionMembers = { collection: { id: params.collectionId } };
      }
      const vendor = typeof params.vendor === 'string' ? params.vendor.trim().toLowerCase() : '';
      if (vendor) {
        // Exact and case-insensitive: narrowed in the database, compared exactly here, then the
        // page itself is read by id so the pagination stays in the database.
        const candidates: { id: number; vendor: string | null }[] = await strapi.db.query(u.product).findMany({
          where: { vendor: { $containsi: vendor } },
          select: ['id', 'vendor'],
        });
        where.id = {
          $in: candidates.filter((r) => (r.vendor ?? '').trim().toLowerCase() === vendor).map((r) => r.id),
        };
      }
      const defaultLocale = await getDefaultLocale();
      const locale = params.locale || defaultLocale;

      const [rows, total] = await Promise.all([
        strapi.db.query(u.product).findMany({
          where,
          orderBy: { id: 'desc' },
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          populate: { translations: true, images: true, variants: { populate: { images: true } } },
        }),
        strapi.db.query(u.product).count({ where }),
      ]);

      const results: ProductListItem[] = rows.map((p: any) => {
        const translations: any[] = p.translations ?? [];
        const name =
          translations.find((t) => t.locale === locale)?.name ??
          translations.find((t) => t.locale === defaultLocale)?.name ??
          '';
        const vs: any[] = [...(p.variants ?? [])].sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0)
        );
        const prices = vs.map((v) => v.price);
        const thumb =
          sortImages(p.images)[0] ?? vs.map((v) => sortImages(v.images)[0]).find(Boolean) ?? null;
        return {
          id: p.id,
          name,
          thumbnailUrl: thumb ? thumb.url : null,
          skus: vs.map((v) => v.sku),
          priceMin: prices.length ? Math.min(...prices) : 0,
          priceMax: prices.length ? Math.max(...prices) : 0,
          stockTotal: vs.reduce((sum, v) => sum + (v.stock ?? 0), 0),
          variantCount: vs.length,
          hasNegativeStock: vs.some((v) => (v.stock ?? 0) < 0),
          active: !!p.active,
        };
      });

      return {
        results,
        pagination: { page, pageSize: PAGE_SIZE, total, pageCount: Math.ceil(total / PAGE_SIZE) },
      };
    },

    async get(id: number): Promise<ProductDetail> {
      const u = uids();
      const p = await strapi.db.query(u.product).findOne({
        where: { id },
        populate: {
          translations: true,
          images: true,
          variants: { populate: { translations: true, images: true } },
          category: true,
          productType: { populate: { translations: true } },
          tags: { populate: { translations: true } },
          collectionMembers: { populate: { collection: { populate: { translations: true } } } },
        },
      });
      if (!p) throw new EcommerceNotFoundError('Product not found');
      const defaultLocale = await getDefaultLocale();

      const categoryId: number | null = p.category?.id ?? null;
      let path: ProductDetail['categoryPath'] = [];
      if (categoryId !== null) {
        const nodes = await loadCategoryNodes();
        const byId = new Map(nodes.map((n) => [n.id, n]));
        path = categoryPath(nodes, categoryId).map((cid) => ({
          id: cid,
          name: pickText(byId.get(cid)?.translations, defaultLocale),
        }));
      }
      const collections: ProductDetail['collections'] = (p.collectionMembers ?? [])
        .map((m: any) => m.collection)
        .filter(Boolean)
        .sort((a: any, b: any) => a.id - b.id)
        .map((c: any) => ({ id: c.id, title: pickText(c.translations, defaultLocale, 'title'), type: c.type }));

      const translations: ProductInput['translations'] = {};
      for (const t of p.translations ?? []) {
        translations[t.locale] = {
          name: t.name,
          slug: t.slug,
          shortDescription: t.shortDescription ?? '',
          description: t.description ?? '',
        };
      }

      const vs: any[] = [...(p.variants ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );
      const usage = await orderUsage(p.id, vs.map((v) => v.id));
      return {
        id: p.id,
        active: !!p.active,
        deletable: !usage.product,
        translations,
        vendor: cleanVendor(p.vendor),
        categoryId,
        categoryPath: path,
        productTypeId: p.productType?.id ?? null,
        productTypeName: p.productType ? pickText(p.productType.translations, defaultLocale) : null,
        tags: [...(p.tags ?? [])]
          .sort((a: any, b: any) => a.id - b.id)
          .map((t: any) => ({ id: t.id, name: pickText(t.translations, defaultLocale) })),
        collections,
        images: sortImages(p.images),
        variants: vs.map((v) => ({
          deletable: !usage.variants.has(v.id),
          id: v.id,
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice ?? null,
          tax: v.tax,
          stock: v.stock,
          weight: v.weight,
          width: v.width,
          height: v.height,
          depth: v.depth,
          active: !!v.active,
          translations: Object.fromEntries(
            (v.translations ?? []).map((t: any) => [t.locale, { option: t.option }])
          ),
          images: sortImages(v.images),
        })),
      };
    },

    async create(input: ProductInput, actor = 'system'): Promise<{ id: number }> {
      return { id: await save(null, input, actor) };
    },

    /** `actor` is recorded on stock movements (e.g. `user:<id>`). */
    async update(id: number, input: ProductInput, actor = 'system'): Promise<void> {
      await save(id, input, actor);
    },

    /** Enables or disables a product on its own (the admin header button), without a full save. */
    async setActive(id: number, active: boolean): Promise<{ active: boolean }> {
      const u = uids();
      const found = await strapi.db.query(u.product).findOne({ where: { id } });
      if (!found) throw new EcommerceNotFoundError('Product not found');
      await strapi.db.query(u.product).update({ where: { id }, data: { active } });
      await syncCollections(id);
      return { active };
    },

    /** Enables or disables one variant on its own (the variant modal button), without a full save. */
    async setVariantActive(id: number, active: boolean): Promise<{ active: boolean }> {
      const u = uids();
      const found = await strapi.db.query(u.variant).findOne({ where: { id }, populate: { product: true } });
      if (!found) throw new EcommerceNotFoundError('Variant not found');
      await strapi.db.query(u.variant).update({ where: { id }, data: { active } });
      if (found.product?.id) await syncCollections(found.product.id);
      return { active };
    },

    /**
     * Deletes a product that was never ordered, with its variants, translations and images.
     * An ordered product is refused with `PRODUCT_IN_ORDERS` (409): deactivate it instead.
     * Stock movements keep their `variantId` as history.
     */
    async delete(id: number): Promise<void> {
      const u = uids();
      const removedImages: StoredImage[] = [];
      await strapi.db.transaction(async () => {
        const p = await strapi.db.query(u.product).findOne({ where: { id }, populate: { variants: true } });
        if (!p) throw new EcommerceNotFoundError('Product not found');
        const variantIds: number[] = (p.variants ?? []).map((v: any) => v.id);
        if ((await orderUsage(id, variantIds)).product) {
          throw new EcommerceValidationError('Invalid product', [{ path: 'product', code: 'PRODUCT_IN_ORDERS' }]);
        }
        const imgs: StoredImage[] = [
          ...(await strapi.db.query(u.image).findMany({ where: { product: id } })),
          ...(variantIds.length
            ? await strapi.db.query(u.image).findMany({ where: { variant: { id: { $in: variantIds } } } })
            : []),
        ];
        if (imgs.length) {
          await strapi.db.query(u.image).deleteMany({ where: { id: { $in: imgs.map((img) => img.id) } } });
          removedImages.push(...imgs);
        }
        for (const variantId of variantIds) {
          await strapi.db.query(u.variantTranslation).deleteMany({ where: { variant: variantId } });
          await strapi.db.query(u.variant).delete({ where: { id: variantId } });
        }
        await strapi.db.query(u.productTranslation).deleteMany({ where: { product: id } });
        await strapi.db.query(u.collectionProduct).deleteMany({ where: { product: { id } } });
        await strapi.db.query(u.product).delete({ where: { id } });
      });
      // Files go only after the rows are gone for good.
      if (removedImages.length) await images().removeFiles(removedImages);
      await syncCollections(id);
    },
  };
};

export default EcommerceProductService;
