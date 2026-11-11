import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { OrderListItem, OrderListParams, Paginated } from '../../orderTypes';

export default class FetchOrders {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(params: OrderListParams = {}): Promise<Paginated<OrderListItem>> {
    return this.gateway.fetchOrders(params);
  }
}
