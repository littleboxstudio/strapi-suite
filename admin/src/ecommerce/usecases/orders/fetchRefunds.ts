import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RefundView } from '../../orderTypes';

export default class FetchRefunds {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number): Promise<RefundView[]> {
    return this.gateway.fetchRefunds(orderId);
  }
}
