import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StoreSettings } from '../../settingsTypes';

export default class FetchStoreSettings {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<StoreSettings> {
    return this.gateway.fetchStore();
  }
}
