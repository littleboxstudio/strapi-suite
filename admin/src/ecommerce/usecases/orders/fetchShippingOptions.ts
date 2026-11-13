import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingQuote } from '../../orderTypes';

export default class FetchShippingOptions {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<ShippingQuote> {
    return this.gateway.fetchShippingOptions(id);
  }
}
