import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PaymentView, StoreCreditPaymentInput } from '../../orderTypes';

export default class AddStoreCreditPayment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: StoreCreditPaymentInput): Promise<PaymentView> {
    return this.gateway.addStoreCreditPayment(orderId, input);
  }
}
