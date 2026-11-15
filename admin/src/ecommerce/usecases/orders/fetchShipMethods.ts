import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShipMethodOption } from '../../orderTypes';

export default class FetchShipMethods {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, locale: string): Promise<ShipMethodOption[]> {
    const { methods } = await this.gateway.fetchShipMethods(orderId, locale);
    return Array.isArray(methods) ? methods : [];
  }
}
