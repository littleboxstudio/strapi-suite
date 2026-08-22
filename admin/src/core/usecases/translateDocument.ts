import Registry from '../di/registry';
import DocumentGateway from '../gateways/documentGateway';
import AiGateway from '../gateways/aiGateway';
import { convertToSlug } from '../utils/convertToSlug';
import {
  collectTranslatableFields,
  countTranslatableFields,
  TranslatableField,
} from '../utils/documentFields';

export default class TranslateDocument {
  documentGateway: DocumentGateway;
  aiGateway: AiGateway;

  constructor() {
    this.documentGateway = Registry.getInstance().inject("documentGateway");
    this.aiGateway = Registry.getInstance().inject("aiGateway");
  }

  async execute(input: Input): Promise<Output> {
    const source = await this.documentGateway.fetch({
      collectionType: input.collectionType,
      model: input.model,
      documentId: input.documentId,
      params: { locale: input.sourceLocale, status: input.status },
    });
    const total = source ? countTranslatableFields(input.attributes, input.components, source) : 0;
    if (total === 0) {
      return {
        results: [],
        translated: 0,
        skipped: 0,
        unmatched: 0,
        failed: 0,
        errors: ['no-source'],
      };
    }

    const matched = collectTranslatableFields(
      input.attributes,
      input.components,
      input.values,
      source
    );
    const unmatched = Math.max(0, total - matched.length);

    const pending = input.overwrite
      ? matched
      : matched.filter((field: TranslatableField) => field.current.trim().length === 0);
    const skipped = matched.length - pending.length;
    if (pending.length === 0) {
      return { results: [], translated: 0, skipped, unmatched, failed: 0, errors: [] };
    }

    const strings = pending.reduce<Record<string, string>>((acc, field, index) => {
      acc[String(index)] = field.kind === 'slug' ? field.value.replace(/-/g, ' ') : field.value;
      return acc;
    }, {});

    const output = await this.aiGateway.translateStrings({
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      strings,
    });

    const results: Result[] = [];
    pending.forEach((field: TranslatableField, index: number) => {
      const translation = output.translations[String(index)];
      if (typeof translation !== 'string' || translation.trim().length === 0) return;
      results.push({
        path: field.path,
        value: field.kind === 'slug' ? convertToSlug(translation) : translation,
        kind: field.kind,
      });
    });

    return {
      results,
      translated: results.length,
      skipped,
      unmatched,
      failed: output.failed,
      errors: output.errors,
    };
  }
}

export type Input = {
  collectionType: string;
  model: string;
  documentId?: string;
  sourceLocale: string;
  targetLocale: string;
  status?: string;
  attributes: Record<string, any>;
  components: Record<string, any>;
  values: any;
  overwrite: boolean;
}

export type Result = {
  path: string;
  value: string;
  kind: string;
}

export type Output = {
  results: Result[];
  translated: number;
  skipped: number;
  unmatched: number;
  failed: number;
  errors: string[];
}
