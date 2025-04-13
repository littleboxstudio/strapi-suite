import Registry from '../di/registry';
import MenuGateway from '../gateways/menuGateway';

export default class FetchMenus {
	menuGateway: MenuGateway;
		
  constructor() {
    this.menuGateway = Registry.getInstance().inject("menuGateway");
  }
	
  async execute(params: Record<string, any> = {}): Promise<Output[]> {
    const result = await this.menuGateway.fetch(params);
    const output = result.map((data: any) => ({
      id: data.id,
      documentId: data.documentId,
      title: data.title,
      uid: data.uid,
      locale: data.locale,
    }));
    return output;
	}
}

export type Output = {
  id: number;
  documentId: string;
  title: string;
  uid: string;
  locale: string;
}