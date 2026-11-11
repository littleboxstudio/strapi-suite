import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';

export default class DeleteShippingMethod {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(id: number): Promise<void> {
    return this.gateway.deleteShippingMethod(id);
  }
}
