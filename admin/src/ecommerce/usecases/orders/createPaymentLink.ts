import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PaymentLink } from '../../orderTypes';

export default class CreatePaymentLink {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number): Promise<PaymentLink> {
    return this.gateway.createPaymentLink(orderId);
  }
}
