import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingOption, ShippingQuoteInput } from '../../orderTypes';

export default class QuoteOrderShipping {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: ShippingQuoteInput): Promise<ShippingOption[]> {
    return this.gateway.quoteShipping(input);
  }
}
