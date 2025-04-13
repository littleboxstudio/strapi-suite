import Registry from '../di/registry';
import ParameterGateway from '../gateways/parameterGateway';

export default class FetchParameters {
	parameterGateway: ParameterGateway;
		
  constructor() {
    this.parameterGateway = Registry.getInstance().inject("parameterGateway");
  }
	
  async execute(params: Record<string, any> = {}): Promise<Output[]> {
    const result = await this.parameterGateway.fetch(params);
    const output = result.map((data: any) => ({
      id: data.id,
      documentId: data.documentId,
      uid: data.uid,
      value: data.value,
      private: data.private,
    }));
    return output;
	}
}

export type Output = {
  id: number;
  documentId: string;
  uid: string;
  value: string;
  private: boolean;
}