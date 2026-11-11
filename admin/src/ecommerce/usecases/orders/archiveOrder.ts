import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { Order } from '../../orderTypes';

export default class ArchiveOrder {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<Order> {
    return this.gateway.archiveOrder(id);
  }
}
