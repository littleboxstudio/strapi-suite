import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

export default class FetchMenu {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(documentId: string): Promise<Output> {
    const result = await this.menuGateway.fetchByDocumentId(documentId);
    const output: Output = {
      id: result.id,
      documentId: result.documentId,
      title: result.title,
      uid: result.uid,
      locale: result.locale,
      children: result.children?.map((child) => ({
        id: child.id,
        parentId: child.parentId,
        title: child.title,
        url: child.url,
        contentId: child.contentId,
        contentModel: child.contentModel,
        metadata: child.metadata,
        target: child.target,
        order: child.order,
      })) || []
    };    
    return output;
	}
}

export type Output = {
  id: number;
  documentId: string;
  title: string;
  uid: string;
  locale: string;
  children: OutputChildren[];
}

export type OutputChildren = {
  id: number;
  title: string;
  target: string;
  order: number;
  parentId?: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
}