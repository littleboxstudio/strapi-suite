import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { OrderLocales } from '../../orderTypes';

export default class FetchOrderLocales {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(): Promise<OrderLocales> {
    return this.gateway.fetchOrderLocales();
  }
}
