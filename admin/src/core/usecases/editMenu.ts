import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

interface IChildren { 
  title: string;
  order: number;
  target: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
  children?: IChildren[];
}

export default class EditMenu {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(documentId: string, params: { uid: string; title: string; children: IChildren[] }): Promise<void> {
    await this.menuGateway.edit(documentId, params);
	}
}