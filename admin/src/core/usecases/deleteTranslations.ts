import Registry from '../di/registry';
import TranslationGateway from '../gateways/translationGateway';

export default class DeleteParameter {
	translationGateway: TranslationGateway;
		
  constructor() {
    this.translationGateway = Registry.getInstance().inject("translationGateway");
  }
	
  async execute(uids: string[]): Promise<void> {
    await this.translationGateway.delete(uids);
	}
}