import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CustomerOrderListItem, CustomerOrderListParams, Paginated } from '../../orderTypes';

export default class FetchCustomerOrders {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, params: CustomerOrderListParams = {}): Promise<Paginated<CustomerOrderListItem>> {
    return this.gateway.fetchCustomerOrders(id, params);
  }
}
