import Registry from '../di/registry';
import TemplateGateway from '../gateways/templateGateway';

export default class CreateMenu {
	templateGateway: TemplateGateway;
		
  constructor() {
    this.templateGateway = Registry.getInstance().inject("templateGateway");
  }
	
  async execute(params: { uid: string; name: string; }): Promise<void> {
    await this.templateGateway.create(params);
	}
}