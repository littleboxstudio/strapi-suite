import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CustomerLastAddresses } from '../../orderTypes';

export default class FetchCustomerLastAddresses {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<CustomerLastAddresses> {
    return this.gateway.fetchCustomerLastAddresses(id);
  }
}
