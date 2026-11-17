import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';

export default class RemovePaymentMethodSuggestion {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(name: string): Promise<{ key: string; hidden: true }> {
    return this.gateway.removePaymentMethodSuggestion(name);
  }
}
