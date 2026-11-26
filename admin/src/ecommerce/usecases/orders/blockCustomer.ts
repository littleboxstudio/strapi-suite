import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { Customer } from '../../orderTypes';

export default class BlockCustomer {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, note: string | null): Promise<Customer> {
    return this.gateway.blockCustomer(id, note);
  }
}
