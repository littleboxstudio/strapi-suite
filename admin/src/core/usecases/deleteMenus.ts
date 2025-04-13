import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

export default class DeleteMenu {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(documentIds: string[], params: Record<string, any> = {}): Promise<void> {
    await this.menuGateway.delete(documentIds, params);
	}
}