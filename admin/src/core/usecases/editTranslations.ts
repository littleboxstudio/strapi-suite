import Registry from '../di/registry';
import TranslationGateway from '../gateways/translationGateway';

export default class EditParameter {
	translationGateway: TranslationGateway;
		
  constructor() {
    this.translationGateway = Registry.getInstance().inject("translationGateway");
  }
	
  async execute(uid: string, params: { uid: string; translation: string; locale: string }[]): Promise<void> {
    await this.translationGateway.edit(uid, params);
	}
}