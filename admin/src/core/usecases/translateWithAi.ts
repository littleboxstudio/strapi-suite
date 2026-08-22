import Registry from '../di/registry';
import TranslationGateway from '../gateways/translationGateway';

export default class TranslateWithAi {
	translationGateway: TranslationGateway;

  constructor() {
    this.translationGateway = Registry.getInstance().inject("translationGateway");
  }

  async execute(input: Input): Promise<Output> {
    return await this.translationGateway.aiTranslate(input);
	}
}

export type Input = {
  sourceLocale: string;
  targetLocales: string[];
  overwrite: boolean;
}

export type Output = {
  translated: number;
  skipped: number;
  failed: number;
  errors: string[];
}
