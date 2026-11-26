import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { Customer } from '../../orderTypes';

export default class UnblockCustomer {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<Customer> {
    return this.gateway.unblockCustomer(id);
  }
}
