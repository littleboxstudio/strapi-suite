import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PaymentMethodSuggestions } from '../../orderTypes';

export default class FetchPaymentMethodSuggestions {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(): Promise<PaymentMethodSuggestions> {
    return this.gateway.fetchPaymentMethodSuggestions();
  }
}
