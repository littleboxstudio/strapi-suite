import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { StoreCredit } from '../../orderTypes';

export default class FetchCustomerStoreCredits {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(customerId: number): Promise<StoreCredit[]> {
    return this.gateway.fetchCustomerStoreCredits(customerId);
  }
}
