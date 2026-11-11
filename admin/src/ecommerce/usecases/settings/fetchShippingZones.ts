import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ShippingZone } from '../../settingsTypes';

export default class FetchShippingZones {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<ShippingZone[]> {
    return this.gateway.fetchShippingZones();
  }
}
