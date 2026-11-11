import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { OrderQuote, OrderQuoteInput } from '../../orderTypes';

export default class QuoteOrder {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: OrderQuoteInput): Promise<OrderQuote> {
    return this.gateway.quote(input);
  }
}
