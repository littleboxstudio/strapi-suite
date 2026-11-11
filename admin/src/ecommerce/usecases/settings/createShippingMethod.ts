import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ManualMethod, ManualMethodInput } from '../../settingsTypes';

export default class CreateShippingMethod {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(input: ManualMethodInput): Promise<ManualMethod> {
    return this.gateway.createShippingMethod(input);
  }
}
