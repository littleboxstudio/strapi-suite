import Registry from '../di/registry';
import TemplateGateway from '../gateways/templateGateway';

export default class fetchTemplates {
	templateGateway: TemplateGateway;
		
  constructor() {
    this.templateGateway = Registry.getInstance().inject("templateGateway");
  }
	
  async execute(): Promise<Output[]> {
    const result = await this.templateGateway.fetch();
    const output = result.map((data: any) => ({
      id: data.id,
      documentId: data.documentId,
      uid: data.uid,
      name: data.name
    }));
    return output;
	}
}

export type Output = {
  id: number;
  documentId: string;
  uid: string;
  name: string;
}
