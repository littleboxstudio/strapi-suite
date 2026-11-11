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
import type { StockMoveInput } from './stock';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';

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

export type ProductDetail = Omit<ProductInput, 'variants'> & {
  id: number;
  images: ImageRecord[];
  variants: (VariantInput & { id: number; images: ImageRecord[] })[];
};

const toImage = (r: any): ImageRecord => ({
  id: r.id,
  name: r.name,
  width: r.width,
  height: r.height,
  sizeBytes: r.sizeBytes,
  url: r.url,
  position: r.position,
});

const sortImages = (images: any[] = []): ImageRecord[] =>
  [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(toImage);

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

  const getDefaultLocale = async (): Promise<string> => locales().getDefaultLocale();

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
      if (id === null) {
        const created = await strapi.db
          .query(u.product)
          .create({ data: { active: input.active } });
        id = created.id as number;
      } else {
        await strapi.db.query(u.product).update({ where: { id }, data: { active: input.active } });
      }
      const ownerId = id as number;

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

      // A variant still used by OPEN orders cannot be deleted (cancelling or modifying those
      // orders needs it): the admin deactivates it instead. Paths index the stored order.
      const ordered = [...current].sort(
        (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id
      );
      const removedIds = ordered.filter((v) => !keptIds.has(v.id)).map((v) => v.id);
      if (removedIds.length) {
        const used: { variantId: number }[] = await strapi.db.query(u.orderLine).findMany({
          where: { variantId: { $in: removedIds }, order: { orderStatus: 'OPEN' } },
          select: ['variantId'],
        });
        const inUse = new Set(used.map((l) => l.variantId));
        const blocked: FieldError[] = ordered
          .map((v, i) =>
            inUse.has(v.id) ? { path: `variants.${i}`, code: 'VARIANT_IN_OPEN_ORDERS' } : null
          )
          .filter((e): e is FieldError => !!e);
        if (blocked.length) throw new EcommerceValidationError('Invalid product', blocked);
      }

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
    return savedId;
  };

  return {
    getDefaultLocale,
    getLocales,

    async list(params: { page: number; search?: string; locale?: string }) {
      const u = uids();
      const page = Math.max(1, params.page || 1);
      const search = params.search?.trim();
      const where = search
        ? {
            $or: [
              { translations: { name: { $containsi: search } } },
              { variants: { sku: { $containsi: search } } },
            ],
          }
        : {};
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
        },
      });
      if (!p) throw new EcommerceNotFoundError('Product not found');

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
      return {
        id: p.id,
        active: !!p.active,
        translations,
        images: sortImages(p.images),
        variants: vs.map((v) => ({
          id: v.id,
          sku: v.sku,
          price: v.price,
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
  };
};

export default EcommerceProductService;
