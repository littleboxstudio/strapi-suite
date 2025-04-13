import Registry from '../di/registry';
import AttributeGateway from '../gateways/attributeGateway';

export default class DeleteAttributes {
	attributeGateway: AttributeGateway;
		
  constructor() {
    this.attributeGateway = Registry.getInstance().inject("attributeGateway");
  }
	
  async execute(contentIds: string[], params: Record<string, any> = {}): Promise<void> {
    await this.attributeGateway.delete(contentIds, params);
	}
}