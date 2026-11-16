import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingQuote, ShipUnits } from '../../orderTypes';

export default class FetchShippingOptionsForUnits {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, lines: ShipUnits): Promise<ShippingQuote> {
    return this.gateway.fetchShippingOptionsForUnits(id, lines);
  }
}
