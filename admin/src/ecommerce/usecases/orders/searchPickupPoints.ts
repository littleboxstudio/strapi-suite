import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PickupPoint } from '../../orderTypes';

export default class SearchPickupPoints {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(postalCode: string): Promise<PickupPoint[]> {
    return (await this.gateway.searchPickupPoints(postalCode)).points;
  }
}
