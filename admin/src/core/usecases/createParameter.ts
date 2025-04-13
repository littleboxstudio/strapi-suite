import Registry from '../di/registry';
import ParameterGateway from '../gateways/parameterGateway';

export default class CreateParameter {
	parameterGateway: ParameterGateway;
		
  constructor() {
    this.parameterGateway = Registry.getInstance().inject("parameterGateway");
  }
	
  async execute(params: { uid: string; value: string; private: boolean }): Promise<void> {
    await this.parameterGateway.create(params);
	}
}