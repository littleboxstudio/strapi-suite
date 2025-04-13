import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

export default class CreateMenu {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(params: { uid: string; title: string; locale: string; }): Promise<void> {
    await this.menuGateway.create(params);
	}
}