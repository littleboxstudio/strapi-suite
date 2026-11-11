import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ShippingZone, ShippingZoneInput } from '../../settingsTypes';

export default class UpdateShippingZone {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(id: number, input: ShippingZoneInput): Promise<ShippingZone> {
    return this.gateway.updateShippingZone(id, input);
  }
}
