import Registry from '../di/registry';
import SlugGateway from '../gateways/slugGateway';

export default class FetchSlugs {
	slugGateway: SlugGateway;
		
  constructor() {
    this.slugGateway = Registry.getInstance().inject("slugGateway");
  }
	
  async execute(params: Record<string, any> = {}): Promise<Output[]> {
    const result = await this.slugGateway.fetch(params);
    const output = result.map((data: any) => ({
      id: data.id,
      slug: data.slug,
      locale: data.locale,
      contentId: data.contentId,
      contentTitle: data.contentTitle,
      contentModel: data.contentModel,
      parentContentId: data.parentContentId,
      parentContentModel: data.parentContentModel
    }));
    return output;
	}
}

export type Output = {
  id: number;
  slug: string;
  locale: string;
  contentId: string;
  contentTitle: string;
  contentModel: string;
  parentContentId: string;
  parentContentModel: string;
}
