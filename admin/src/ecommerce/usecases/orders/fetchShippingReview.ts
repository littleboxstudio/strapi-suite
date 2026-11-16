import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingReview } from '../../orderTypes';

export default class FetchShippingReview {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<ShippingReview> {
    return this.gateway.fetchShippingReview(id);
  }
}
