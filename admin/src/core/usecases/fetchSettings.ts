import Registry from '../di/registry';
import SettingGateway from '../gateways/settingGateway';

export default class FetchSettings {
	settingGateway: SettingGateway;
		
  constructor() {
    this.settingGateway = Registry.getInstance().inject("settingGateway");
  }
	
  async execute(): Promise<Output[]> {
    const output = await this.settingGateway.fetch();
    return output;
	}
}

export type Output = {
  module: string,
  settings: Record<string, any>
}