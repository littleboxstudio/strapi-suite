import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StorePickupInput, StorePickupSaveResult } from '../../settingsTypes';

export default class SaveStorePickup {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(config: StorePickupInput): Promise<StorePickupSaveResult> {
    return this.gateway.saveStorePickup(config);
  }
}
