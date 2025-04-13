import Registry from '../di/registry';
import AttributeGateway from '../gateways/attributeGateway';

export default class FetchAttributes {
	attributeGateway: AttributeGateway;
		
  constructor() {
    this.attributeGateway = Registry.getInstance().inject("attributeGateway");
  }
	
  async execute(params: Record<string, any> = {}): Promise<Output[]> {
    const result = await this.attributeGateway.fetch(params);
    const output = result.map((data: any) => ({
      id: data.id,
      contentId: data.contentId,
      contentModel: data.contentModel,
      contentTitle: data.contentTitle,
      parentContentId: data.parentContentId,
      parentContentModel: data.parentContentModel,
      parentContentTitle: data.parentContentTitle,
      templateId: data.templateId,
      templateTitle: data.templateTitle,
      priority: data.priority,
      frequency: data.frequency
    }));
    return output;
	}
}

export type Output = {
  id: number;
  contentId: string;
  contentModel: string;
  contentTitle: string;
  parentContentId: string;
  parentContentModel: string;
  parentContentTitle: string;
  templateId: string;
  templateTitle: string;
  priority: string;
  frequency: string;
}
