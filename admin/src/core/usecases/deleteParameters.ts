import Registry from '../di/registry';
import ParameterGateway from '../gateways/parameterGateway';

export default class DeleteParameter {
	parameterGateway: ParameterGateway;
		
  constructor() {
    this.parameterGateway = Registry.getInstance().inject("parameterGateway");
  }
	
  async execute(documentIds: string[]): Promise<void> {
    await this.parameterGateway.delete(documentIds);
	}
}