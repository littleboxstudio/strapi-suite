import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ManualMethod } from '../../settingsTypes';

export default class FetchShippingMethods {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<ManualMethod[]> {
    return this.gateway.fetchShippingMethods();
  }
}
