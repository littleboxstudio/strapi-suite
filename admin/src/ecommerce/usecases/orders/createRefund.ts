import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CreateRefundInput, RefundView } from '../../orderTypes';

export default class CreateRefund {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: CreateRefundInput): Promise<RefundView[]> {
    return this.gateway.createRefund(orderId, input);
  }
}
