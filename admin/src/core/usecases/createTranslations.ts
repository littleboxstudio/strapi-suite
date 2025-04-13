import Registry from '../di/registry';
import TranslationGateway from '../gateways/translationGateway';

export default class CreateTranslations {
	translationGateway: TranslationGateway;
		
  constructor() {
    this.translationGateway = Registry.getInstance().inject("translationGateway");
  }
	
  async execute(params: { uid: string; translation: string; locale: string }[]): Promise<void> {
    await this.translationGateway.create(params);
	}
}