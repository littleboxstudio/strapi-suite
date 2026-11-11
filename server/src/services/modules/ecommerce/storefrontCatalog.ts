import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { sanitizeSearchTerm } from './domain/storefront/request';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';

/** Image exactly as stored by the upload provider. `alt` is the product name (no `alt` column exists). */
export type PublicImage = { url: string; width: number; height: number; alt: string };

export type PublicProductListItem = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  image: PublicImage | null;
  priceMin: number;
  priceMax: number;
  currency: 'EUR';
  available: boolean;
};

export type PublicVariant = {
  id: number;
  option: string;
  sku: string;
  /** VAT-inclusive cents. */
  price: number;
  /** VAT rate in percent, as stored. */
  taxRate: number;
  available: boolean;
  images: PublicImage[];
};

export type PublicProduct = {
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
  available: boolean;
  variants: PublicVariant[];
};

export type PublicProductPage = {
  results: PublicProductListItem[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const SORTS = ['newest', 'price_asc', 'price_desc', 'name_asc'] as const;

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

  const toImages = (rows: any[] | undefined, alt: string): PublicImage[] =>
    [...(rows ?? [])]
      .sort(byPosition)
      .map((i) => ({ url: i.url, width: i.width, height: i.height, alt }));

  const activeVariants = (p: any): any[] =>
    [...(p.variants ?? [])].filter((v) => v.active).sort(byPosition);

  const summary = (vs: any[]) => {
    const prices = vs.map((v) => v.price as number);
    return {
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      available: vs.some((v) => (v.stock ?? 0) > 0),
    };
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
      locale: string;
    }): Promise<PublicProductPage> {
      const u = uids();
      const page = intParam(q.page, 'page', 1, 1, 1_000_000);
      const pageSize = intParam(q.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
      const sort = q.sort === undefined || q.sort === '' ? 'newest' : q.sort;
      if (typeof sort !== 'string' || !(SORTS as readonly string[]).includes(sort)) {
        bad('sort', 'invalid_sort');
      }
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
      const rows: any[] = unique(
        await strapi.db.query(u.product).findMany({
          where,
          orderBy: { id: 'desc' },
          // Only what the list view needs: no descriptions, no variant dimensions.
          populate: {
            translations: { select: ['locale', 'name', 'slug', 'shortDescription'] },
            variants: { select: ['price', 'tax', 'active', 'stock', 'position'] },
          },
        })
      ).filter((p) => activeVariants(p).length > 0);

      const entries = rows.map((p) => ({
        p,
        name: nameOf(p, q.locale, defaultLocale),
        ...summary(activeVariants(p)),
      }));
      if (sort === 'price_asc') entries.sort((a, b) => a.priceMin - b.priceMin || b.p.id - a.p.id);
      else if (sort === 'price_desc')
        entries.sort((a, b) => b.priceMax - a.priceMax || b.p.id - a.p.id);
      else if (sort === 'name_asc')
        entries.sort((a, b) => a.name.localeCompare(b.name, q.locale) || b.p.id - a.p.id);
      else entries.sort((a, b) => b.p.id - a.p.id);

      const total = entries.length;
      const slice = entries.slice((page - 1) * pageSize, page * pageSize);

      // Images are loaded only for the page being returned.
      const withImages: any[] = slice.length
        ? await strapi.db.query(u.product).findMany({
            where: { id: { $in: slice.map((e) => e.p.id) } },
            populate: { images: true, variants: { populate: { images: true } } },
          })
        : [];
      const imagesById = new Map(withImages.map((p) => [p.id, p]));

      const results: PublicProductListItem[] = slice.map((e) => {
        const full = imagesById.get(e.p.id);
        const productImage = toImages(full?.images, e.name)[0];
        const variantImage = activeVariants(full ?? {})
          .map((v) => toImages(v.images, e.name)[0])
          .find(Boolean);
        return {
          id: e.p.id,
          slug: slugFor(e.p, q.locale, defaultLocale),
          name: e.name,
          shortDescription: pickText(e.p.translations, q.locale, defaultLocale, 'shortDescription'),
          image: productImage ?? variantImage ?? null,
          priceMin: e.priceMin,
          priceMax: e.priceMax,
          currency: 'EUR',
          available: e.available,
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
        variants: vs.map((v) => {
          const own = toImages(v.images, name);
          return {
            id: v.id,
            option: pickText(v.translations, locale, defaultLocale, 'option'),
            sku: v.sku,
            price: v.price,
            taxRate: v.tax,
            available: (v.stock ?? 0) > 0,
            images: own.length ? own : images,
          };
        }),
      };
    },
  };
};

export default EcommerceStorefrontCatalogService;
