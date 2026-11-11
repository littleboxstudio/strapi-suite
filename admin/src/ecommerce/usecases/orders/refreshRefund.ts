import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RefundView } from '../../orderTypes';

export default class RefreshRefund {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(refundId: number): Promise<RefundView> {
    return this.gateway.refreshRefund(refundId);
  }
}
