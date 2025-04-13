import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

export default class DuplicateMenu {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(documentId: string, locale: string): Promise<void> {
    await this.menuGateway.duplicate(documentId, locale);
	}
}