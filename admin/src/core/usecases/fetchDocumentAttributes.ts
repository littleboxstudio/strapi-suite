import Registry from '../di/registry';
import AttributeGateway from '../gateways/attributeGateway';

export default class fetchDocumentAttributes {
	attributeGateway: AttributeGateway;
		
  constructor() {
    this.attributeGateway = Registry.getInstance().inject("attributeGateway");
  }
	
  async execute(contentId: string, params: Record<string, any> = {}): Promise<Output> {
    const result: any = await this.attributeGateway.fetchByContentId(contentId, params);
    const output = {
      id: result.id,
      locale: result.locale,
      contentId: result.contentId,
      contentModel: result.contentModel,
      parentContentId: result.parentContentId,
      parentContentModel: result.parentContentModel,
      templateId: result.templateId,
      priority: result.priority,
      frequency: result.frequency,
    };
    return output;
	}
}

export type Output = {
  id: number;
  contentId: string;
  contentModel: string;
  parentContentId: string;
  parentContentModel: string;
  templateId: string;
  locale: string;
  priority: string;
  frequency: string;
}
