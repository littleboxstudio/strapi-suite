import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CustomerListItem, CustomerListParams, Paginated } from '../../orderTypes';

export default class FetchCustomers {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(params: CustomerListParams = {}): Promise<Paginated<CustomerListItem>> {
    return this.gateway.fetchCustomers(params);
  }
}
