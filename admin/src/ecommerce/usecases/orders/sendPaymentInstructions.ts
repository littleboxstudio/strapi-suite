import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PaymentInstructionsInput, PaymentInstructionsResult } from '../../orderTypes';

export default class SendPaymentInstructions {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: PaymentInstructionsInput): Promise<PaymentInstructionsResult> {
    return this.gateway.sendPaymentInstructions(orderId, input);
  }
}
