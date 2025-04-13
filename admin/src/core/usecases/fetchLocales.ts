import Registry from '../di/registry';
import LocaleGateway from '../gateways/localeGateway';

export default class FetchLocales {
	localeGateway: LocaleGateway;
		
  constructor() {
    this.localeGateway = Registry.getInstance().inject("localeGateway");
  }
	
  async execute(): Promise<Output[]> {
    const result = await this.localeGateway.fetch();
    const output = result.map((data: any) => ({
      id: data.id,
      code: data.code,
      name: data.name,
      isDefault: data.isDefault
    }));
    return output;
	}
}

export type Output = {
  id: number;
  code: string;
  name: string;
  isDefault: boolean;
}