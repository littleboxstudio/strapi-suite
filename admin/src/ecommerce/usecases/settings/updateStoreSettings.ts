import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StoreSettings, StoreSettingsInput } from '../../settingsTypes';

export default class UpdateStoreSettings {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(input: Partial<StoreSettingsInput>): Promise<StoreSettings> {
    return this.gateway.updateStore(input);
  }
}
