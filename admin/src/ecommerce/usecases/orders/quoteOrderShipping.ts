import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingQuote, ShippingQuoteInput } from '../../orderTypes';

export default class QuoteOrderShipping {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: ShippingQuoteInput): Promise<ShippingQuote> {
    return this.gateway.quoteShipping(input);
  }
}
