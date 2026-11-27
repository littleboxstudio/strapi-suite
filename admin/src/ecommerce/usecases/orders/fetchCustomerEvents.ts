import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CustomerEvent, CustomerEventListParams, Paginated } from '../../orderTypes';

export default class FetchCustomerEvents {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, params: CustomerEventListParams = {}): Promise<Paginated<CustomerEvent>> {
    return this.gateway.fetchCustomerEvents(id, params);
  }
}
