import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RefundPreview } from '../../orderTypes';

export default class FetchRefundPreview {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number): Promise<RefundPreview> {
    return this.gateway.fetchRefundPreview(orderId);
  }
}
