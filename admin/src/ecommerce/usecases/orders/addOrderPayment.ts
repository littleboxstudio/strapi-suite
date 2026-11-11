import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ManualPaymentInput, PaymentView } from '../../orderTypes';

export default class AddOrderPayment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: ManualPaymentInput): Promise<PaymentView> {
    return this.gateway.addPayment(orderId, input);
  }
}
