import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RefundView } from '../../orderTypes';

export default class MarkRefundFailed {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(refundId: number, note?: string): Promise<RefundView> {
    return this.gateway.markRefundFailed(refundId, note);
  }
}
