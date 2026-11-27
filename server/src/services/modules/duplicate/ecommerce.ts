/**
 * The e-commerce part of a duplication: the translation rows of products, variants, categories,
 * collections and tags, and the e-mail templates customized in the source locale. Each becomes one
 * item of the run, processed like a document (skip / replace, translated, failures reported).
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  isBlank,
  isBlankHtml,
  resolveUniqueSlug,
  sanitizeDescription,
  slugify,
} from '../ecommerce/domain/catalog';
import { applyTranslation, decodeEntities, splitTemplate, translationStrings } from './domain/emailTemplateText';

export type ItemOutcome = {
  outcome: 'duplicated' | 'replaced' | 'skipped';
  untranslated: boolean;
  /** Why the item was skipped when it should be reported (recorded as a failure of the run). */
  reason?: string;
};

export type EcommerceItem = {
  /** Reported as the item's content type: the translation (or e-mail template) uid. */
  uid: string;
  /** The owner id (or the e-mail template type). */
  documentId: string;
  title?: string;
  run(): Promise<ItemOutcome>;
};

/** Translates keyed strings; keys missing from the answer were not translated. */
export type TranslateFn = (strings: Record<string, string>) => Promise<Record<string, string>>;

export type EcommerceContext = {
  source: string;
  target: string;
  existing: 'skip' | 'replace';
  userId: string | null;
  translate: TranslateFn;
};

export type EcommerceCounts = {
  products: number;
  variants: number;
  categories: number;
  collections: number;
  tags: number;
  emailTemplates: number;
};

type KindKey = Exclude<keyof EcommerceCounts, 'emailTemplates'>;

type Kind = {
  key: KindKey;
  owner: string;
  translation: string;
  /** The relation of the translation row to its owner. */
  rel: string;
  /** The text fields copied (and translated). */
  fields: string[];
  /** The required name field (kept from the source when its translation is blank). */
  nameField: string;
  /** Fields holding sanitized HTML. */
  html: string[];
  /** Slug fallback when the name slugifies to nothing; absent: the row has no slug. */
  slugFallback?: string;
};

const kinds = (strapi: Core.Strapi): Kind[] => {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const u = config.uuid.modules.ecommerce;
  return [
    {
      key: 'products',
      owner: u.product,
      translation: u.productTranslation,
      rel: 'product',
      fields: ['name', 'shortDescription', 'description'],
      nameField: 'name',
      html: ['description'],
      slugFallback: 'product',
    },
    {
      key: 'variants',
      owner: u.variant,
      translation: u.variantTranslation,
      rel: 'variant',
      fields: ['option'],
      nameField: 'option',
      html: [],
    },
    {
      key: 'categories',
      owner: u.category,
      translation: u.categoryTranslation,
      rel: 'category',
      fields: ['name', 'description', 'seoTitle', 'seoDescription'],
      nameField: 'name',
      html: [],
      slugFallback: 'category',
    },
    {
      key: 'collections',
      owner: u.collection,
      translation: u.collectionTranslation,
      rel: 'collection',
      fields: ['title', 'description', 'seoTitle', 'seoDescription'],
      nameField: 'title',
      html: [],
      slugFallback: 'collection',
    },
    {
      key: 'tags',
      owner: u.tag,
      translation: u.tagTranslation,
      rel: 'tag',
      fields: ['name'],
      nameField: 'name',
      html: [],
    },
  ];
};

const emailTemplates = (strapi: Core.Strapi) => strapi.plugin(PLUGIN_ID).service('EcommerceEmailTemplateService');

const isFilledText = (kind: Kind, field: string, value: unknown): value is string =>
  typeof value === 'string' && (kind.html.includes(field) ? !isBlankHtml(value) : !isBlank(value));

const short = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;

/** How many e-commerce items a run would process from the source locale. */
export async function countEcommerce(strapi: Core.Strapi, source: string): Promise<EcommerceCounts> {
  const counts: any = {};
  for (const kind of kinds(strapi)) {
    counts[kind.key] = await strapi.db.query(kind.translation as any).count({ where: { locale: source } });
  }
  const list: { customLocales: string[] }[] = await emailTemplates(strapi).list();
  counts.emailTemplates = list.filter((t) => t.customLocales.includes(source)).length;
  return counts;
}

function translationItems(strapi: Core.Strapi, kind: Kind, owners: any[], ctx: EcommerceContext): EcommerceItem[] {
  const rowsOf = (owner: any): any[] => (Array.isArray(owner.translations) ? owner.translations : []);

  const items: EcommerceItem[] = [];
  for (const owner of owners) {
    const source = rowsOf(owner).find((r) => r.locale === ctx.source);
    if (!source) continue;
    items.push({
      uid: kind.translation,
      documentId: String(owner.id),
      title: short(source[kind.nameField]),
      async run() {
        const query = strapi.db.query(kind.translation as any);
        // Read now, not when the items were listed: the content part of the run may take minutes,
        // and a translation saved meanwhile must be replaced or skipped, never created twice.
        const target = await query.findOne({ where: { [kind.rel]: owner.id, locale: ctx.target } });
        if (target && ctx.existing === 'skip') return { outcome: 'skipped', untranslated: false };

        const strings: Record<string, string> = {};
        for (const field of kind.fields) {
          if (isFilledText(kind, field, source[field])) strings[field] = source[field];
        }
        const translations = Object.keys(strings).length ? await ctx.translate(strings) : {};
        let untranslated = false;
        const data: Record<string, any> = { locale: ctx.target, [kind.rel]: owner.id };
        for (const field of kind.fields) {
          const value = source[field];
          if (!(field in strings)) {
            data[field] = typeof value === 'string' ? value : null;
            continue;
          }
          const translated = translations[field];
          if (typeof translated === 'string' && translated.trim()) {
            data[field] = field === kind.nameField ? translated.trim() : translated;
          } else {
            untranslated = true;
            data[field] = value;
          }
        }
        for (const field of kind.html) data[field] = sanitizeDescription(data[field] ?? '');
        if (kind.key === 'products') data.shortDescription = data.shortDescription ?? '';

        if (kind.slugFallback) {
          // The e-commerce rule: a slug is stable once set, generated from the name on creation.
          if (target?.slug) {
            data.slug = target.slug;
          } else {
            // Every slug of the target locale, rows without an owner included (the unique index is on
            // locale + slug, whatever the owner).
            const rows: { id: number; slug: string | null }[] =
              (await query.findMany({ where: { locale: ctx.target }, select: ['id', 'slug'] })) ?? [];
            const taken = rows.filter((r) => r.id !== target?.id && r.slug).map((r) => r.slug as string);
            data.slug = resolveUniqueSlug(slugify(String(data[kind.nameField] ?? '')) || kind.slugFallback, taken);
          }
        }

        if (target) {
          await query.update({ where: { id: target.id }, data });
          return { outcome: 'replaced', untranslated };
        }
        await query.create({ data });
        return { outcome: 'duplicated', untranslated };
      },
    });
  }
  return items;
}

function emailTemplateItems(strapi: Core.Strapi, list: { type: string; customLocales: string[] }[], ctx: EcommerceContext): EcommerceItem[] {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  return list
    .filter((t) => t.customLocales.includes(ctx.source))
    .map((t) => ({
      uid: config.uuid.modules.ecommerce.emailTemplate,
      documentId: t.type,
      title: t.type,
      async run(): Promise<ItemOutcome> {
        const exists = t.customLocales.includes(ctx.target);
        if (exists && ctx.existing === 'skip') return { outcome: 'skipped', untranslated: false };
        const view = await emailTemplates(strapi).get(t.type, ctx.source);
        const parts = splitTemplate(String(view.html ?? ''));
        const subject = String(view.subject ?? '');
        const strings = translationStrings(subject, parts);
        const translations = Object.keys(strings).length ? await ctx.translate(strings) : {};
        const untranslated = Object.keys(strings).some(
          (key) => !(typeof translations[key] === 'string' && translations[key].trim())
        );
        // A custom template takes priority over the built-in one of the target language, which is
        // already translated: a copy in the source language (even in part) would be worse than none.
        if (untranslated) {
          return {
            outcome: 'skipped',
            untranslated: true,
            reason: exists
              ? `Not translated (AI unavailable or the translation failed): the current ${ctx.target} template is kept`
              : `Not translated (AI unavailable or the translation failed): the built-in ${ctx.target} template is kept`,
          };
        }
        const result = applyTranslation(subject, parts, translations, decodeEntities);
        await emailTemplates(strapi).save(t.type, ctx.target, result, ctx.userId ?? undefined);
        return { outcome: exists ? 'replaced' : 'duplicated', untranslated: false };
      },
    }));
}

/** Every e-commerce item of a run, in a stable order (products, variants, ..., e-mail templates). */
export async function loadEcommerceItems(strapi: Core.Strapi, ctx: EcommerceContext): Promise<EcommerceItem[]> {
  const items: EcommerceItem[] = [];
  for (const kind of kinds(strapi)) {
    const owners: any[] = await strapi.db.query(kind.owner as any).findMany({
      populate: { translations: true },
      orderBy: [{ id: 'asc' }],
    });
    items.push(...translationItems(strapi, kind, owners, ctx));
  }
  const list = await emailTemplates(strapi).list();
  items.push(...emailTemplateItems(strapi, list, ctx));
  return items;
}
