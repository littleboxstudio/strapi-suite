import Registry from '../di/registry';
import TemplateGateway from '../gateways/templateGateway';

export default class EditMenu {
	templateGateway: TemplateGateway;
		
  constructor() {
    this.templateGateway = Registry.getInstance().inject("templateGateway");
  }
	
  async execute(documentId: string, params: { uid: string; name: string; }): Promise<void> {
    await this.templateGateway.edit(documentId, params);
	}
}