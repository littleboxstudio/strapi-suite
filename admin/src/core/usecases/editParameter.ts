import Registry from '../di/registry';
import ParameterGateway from '../gateways/parameterGateway';

export default class EditParameter {
	parameterGateway: ParameterGateway;
		
  constructor() {
    this.parameterGateway = Registry.getInstance().inject("parameterGateway");
  }
	
  async execute(documentId: string, params: { uid: string; value: string; private: boolean }): Promise<void> {
    await this.parameterGateway.edit(documentId, params);
	}
}