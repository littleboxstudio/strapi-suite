import Mediator from '../mediator/mediator';
import Registry from '../di/registry';
import SettingGateway from '../gateways/settingGateway';
import AppSettingsUpdated from '../events/appSettingsUpdated';

export default class UpdateSetting {
  settingGateway: SettingGateway;
  mediator: Mediator;
		
  constructor() {
    this.settingGateway = Registry.getInstance().inject("settingGateway");
    this.mediator = Registry.getInstance().inject("mediator");
  }
	
  async execute(input: Input): Promise<void> {
    await this.settingGateway.update(input);
    this.mediator.notify(new AppSettingsUpdated(input));
	}
}

type Input = {
  module: string;
  property: string;
  value: any;
}