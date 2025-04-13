import Registry from '../di/registry';
import TemplateGateway from '../gateways/templateGateway';

export default class DeleteParameter {
	templateGateway: TemplateGateway;
		
  constructor() {
    this.templateGateway = Registry.getInstance().inject("templateGateway");
  }
	
  async execute(documentIds: string[]): Promise<void> {
    await this.templateGateway.delete(documentIds);
	}
}