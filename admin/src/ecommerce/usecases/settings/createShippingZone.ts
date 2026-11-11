import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ShippingZone, ShippingZoneInput } from '../../settingsTypes';

export default class CreateShippingZone {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(input: ShippingZoneInput): Promise<ShippingZone> {
    return this.gateway.createShippingZone(input);
  }
}
