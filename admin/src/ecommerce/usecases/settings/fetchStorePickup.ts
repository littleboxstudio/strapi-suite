import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StorePickupConfig } from '../../settingsTypes';

export default class FetchStorePickup {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<StorePickupConfig> {
    return this.gateway.fetchStorePickup();
  }
}
