import type { Core } from '@strapi/strapi';
import {
  PLUGIN_ID,
  LtbConfigs,
  AI_TRANSLATION_MODULE,
  AI_TRANSLATION_DEFAULT_MODEL,
  AI_TRANSLATION_BATCH_SIZE,
  OPENAI_CHAT_COMPLETIONS_URL,
} from '../../config';

const REQUEST_TIMEOUT = 120000;

export interface Locale {
  code: string;
  name: string;
}

export interface Credentials {
  apiKey: string;
  model: string;
}

export interface TranslationEntry {
  uid: string;
  translations: Record<string, string>;
}

export interface TranslateStringsResult {
  translations: Record<string, string>;
  failed: number;
  errors: string[];
}

function groupByUid(items: any[]): TranslationEntry[] {
  const groupedMap = items.reduce<Record<string, TranslationEntry>>((acc, item) => {
    if (!acc[item.uid]) {
      acc[item.uid] = { uid: item.uid, translations: {} };
    }
    acc[item.uid].translations[item.locale] = item.translation;
    return acc;
  }, {});
  return Object.values(groupedMap);
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function isFilled(value: any): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildSystemPrompt(source: Locale, target: Locale): string {
  return [
    `You are a professional translator and copywriter, a native speaker of ${target.name} (locale code ${target.code}), translating from ${source.name} (locale code ${source.code}).`,
    `The strings you receive are interface copy: labels, buttons, titles, menu entries, notifications and short messages shown to the users of a website or application.`,
    `Translate them so that a native ${target.name} speaker would never suspect the text was translated. Follow every rule below.`,
    ``,
    `1. Translate the meaning, never word by word. When the source uses an idiom, a saying, a metaphor or a play on words, replace it with the expression a native ${target.name} speaker would genuinely use in the same situation. Preserving the intent and the logic behind the sentence matters more than preserving its words. When no natural equivalent exists, write the plain, natural sentence that carries the same idea.`,
    `2. Do not use hyphens or dashes of any kind (-, –, —) as a stylistic device to join clauses, ideas or appositions. Rewrite the sentence instead, splitting it or using the connectors that are natural in ${target.name}. Hyphens are acceptable only when they are a mandatory part of the correct spelling of a word in ${target.name}.`,
    `3. Match the register and the tone of the source. Informal stays informal, formal stays formal, and the form of address must be the one standard for user interfaces in ${target.name}.`,
    `4. Stay close to the length of the source. Interface copy has to fit inside buttons and labels, so be concise and never add words the source does not have.`,
    `5. Preserve exactly, without translating: placeholders such as {name}, {{name}}, %s, %d, :param and $variable; HTML tags and entities; markdown syntax; URLs; email addresses; numbers; and brand or product names.`,
    `6. Preserve the capitalisation style of the source (sentence case, Title Case, ALL CAPS) adapted to what is correct in ${target.name}, and keep the leading and trailing punctuation, the ellipses and the question or exclamation marks.`,
    `7. Use the spelling, the vocabulary and the conventions of the ${target.name} variant identified by the code ${target.code}.`,
    `8. Never explain, comment or add anything, and never leave any part of the text in the source language.`,
    ``,
    `You receive a JSON object that maps keys to source strings. Return a JSON object with exactly the same keys, where each value is the translation of the corresponding source string. Return nothing else.`,
  ].join('\n');
}

async function requestOpenAi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  payload: Record<string, string>,
  withTemperature: boolean = true
): Promise<Record<string, string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const body: Record<string, any> = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    };
    if (withTemperature) body.temperature = 0.3;
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.text();
      if (withTemperature && response.status === 400 && error.includes('temperature')) {
        clearTimeout(timeout);
        return requestOpenAi(apiKey, model, systemPrompt, payload, false);
      }
      throw new Error(`OpenAI request failed with status ${response.status}: ${error}`);
    }
    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned an empty response');
    return JSON.parse(content);
  } finally {
    clearTimeout(timeout);
  }
}

const AiTranslationModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getLocales(): Promise<Locale[]> {
    const locales = await strapi.plugin('i18n').service('locales').find();
    return locales.map((locale: any) => ({ code: locale.code, name: locale.name }));
  },

  async getCredentials(): Promise<Credentials | null> {
    const settingService = strapi.plugin(PLUGIN_ID).service('SettingAppService');
    const aiEnabled = await settingService.getRawValue(AI_TRANSLATION_MODULE, 'aiEnabled');
    if (aiEnabled !== 'true') return null;
    const apiKey = await settingService.getRawValue(AI_TRANSLATION_MODULE, 'aiApiKey');
    if (!isFilled(apiKey)) return null;
    const storedModel = await settingService.getRawValue(AI_TRANSLATION_MODULE, 'aiModel');
    return {
      apiKey,
      model: isFilled(storedModel) ? storedModel : AI_TRANSLATION_DEFAULT_MODEL,
    };
  },

  async translateStrings(
    credentials: Credentials,
    source: Locale,
    target: Locale,
    strings: Record<string, string>
  ): Promise<TranslateStringsResult> {
    const translations: Record<string, string> = {};
    const errors: string[] = [];
    let failed = 0;
    const systemPrompt = buildSystemPrompt(source, target);
    const keys = Object.keys(strings).filter((key) => isFilled(strings[key]));
    for (const batch of chunk(keys, AI_TRANSLATION_BATCH_SIZE)) {
      const payload = batch.reduce<Record<string, string>>((acc, key) => {
        acc[key] = strings[key];
        return acc;
      }, {});
      let result: Record<string, string>;
      try {
        result = await requestOpenAi(credentials.apiKey, credentials.model, systemPrompt, payload);
      } catch (e: any) {
        failed += batch.length;
        errors.push(`${target.code}: ${e.message}`);
        strapi.log.error(`[${PLUGIN_ID}] AI translation failed for ${target.code}: ${e.message}`);
        continue;
      }
      for (const key of batch) {
        if (isFilled(result[key])) {
          translations[key] = result[key];
        } else {
          failed += 1;
        }
      }
    }
    return { translations, failed, errors };
  },

  async adminTranslate() {
    const ctx = strapi.requestContext.get();
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const { sourceLocale, targetLocales, overwrite } = ctx.request.body as {
      sourceLocale?: string;
      targetLocales?: string[];
      overwrite?: boolean;
    };

    const credentials = await this.getCredentials();
    if (!credentials) {
      return ctx.badRequest('AI translations are disabled or the OpenAI API key is not set');
    }

    if (!isFilled(sourceLocale)) {
      return ctx.badRequest('A source locale is required');
    }
    const targets = (targetLocales || []).filter(
      (locale) => isFilled(locale) && locale !== sourceLocale
    );
    if (targets.length === 0) {
      return ctx.badRequest('At least one target locale is required');
    }

    const locales = await this.getLocales();
    const source = locales.find((locale: Locale) => locale.code === sourceLocale);
    if (!source) {
      return ctx.badRequest(`The locale ${sourceLocale} is not configured in Strapi`);
    }

    const query = strapi.db.query(config.uuid.modules.translation);
    const documents = await query.findMany({ select: ['id', 'uid', 'translation', 'locale'] });
    const entries = groupByUid(documents).filter((entry) =>
      isFilled(entry.translations[source.code])
    );
    if (entries.length === 0) {
      return { translated: 0, skipped: 0, failed: 0, errors: [] };
    }

    let translated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const targetCode of targets) {
      const target = locales.find((locale: Locale) => locale.code === targetCode);
      if (!target) {
        errors.push(`The locale ${targetCode} is not configured in Strapi`);
        continue;
      }
      const pending = entries.filter(
        (entry) => overwrite || !isFilled(entry.translations[target.code])
      );
      skipped += entries.length - pending.length;
      if (pending.length === 0) continue;

      const strings = pending.reduce<Record<string, string>>((acc, entry) => {
        acc[entry.uid] = entry.translations[source.code];
        return acc;
      }, {});
      const result = await this.translateStrings(credentials, source, target, strings);
      failed += result.failed;
      errors.push(...result.errors);

      for (const [uid, translation] of Object.entries(result.translations)) {
        const existing = await query.findOne({ where: { uid, locale: target.code } });
        if (existing) {
          await query.update({ where: { id: existing.id }, data: { translation } });
        } else {
          await query.create({ data: { uid, translation, locale: target.code } });
        }
        const entry = entries.find((item) => item.uid === uid);
        if (entry) entry.translations[target.code] = translation;
        translated += 1;
      }
    }

    return { translated, skipped, failed, errors };
  },

  async adminTranslateStrings() {
    const ctx = strapi.requestContext.get();
    const { sourceLocale, targetLocale, strings } = ctx.request.body as {
      sourceLocale?: string;
      targetLocale?: string;
      strings?: Record<string, string>;
    };

    const credentials = await this.getCredentials();
    if (!credentials) {
      return ctx.badRequest('AI translations are disabled or the OpenAI API key is not set');
    }
    if (!isFilled(sourceLocale) || !isFilled(targetLocale)) {
      return ctx.badRequest('A source locale and a target locale are required');
    }
    if (sourceLocale === targetLocale) {
      return ctx.badRequest('The source locale and the target locale must be different');
    }
    if (!strings || Object.keys(strings).length === 0) {
      return { translations: {}, failed: 0, errors: [] };
    }

    const locales = await this.getLocales();
    const source = locales.find((locale: Locale) => locale.code === sourceLocale);
    const target = locales.find((locale: Locale) => locale.code === targetLocale);
    if (!source) return ctx.badRequest(`The locale ${sourceLocale} is not configured in Strapi`);
    if (!target) return ctx.badRequest(`The locale ${targetLocale} is not configured in Strapi`);

    return await this.translateStrings(credentials, source, target, strings);
  },
});

export default AiTranslationModuleService;
