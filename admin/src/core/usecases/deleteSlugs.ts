import Registry from '../di/registry';
import SlugGateway from '../gateways/slugGateway';

export default class DeleteSlugs {
	slugGateway: SlugGateway;
		
  constructor() {
    this.slugGateway = Registry.getInstance().inject("slugGateway");
  }
	
  async execute(contentIds: string[], params: Record<string, any> = {}): Promise<void> {
    await this.slugGateway.delete(contentIds, params);
	}
}