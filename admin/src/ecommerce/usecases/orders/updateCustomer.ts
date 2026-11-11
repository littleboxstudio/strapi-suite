import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { Customer, CustomerInput } from '../../orderTypes';

export default class UpdateCustomer {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: CustomerInput): Promise<Customer> {
    return this.gateway.updateCustomer(id, input);
  }
}
