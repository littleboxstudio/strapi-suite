import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { Address, EditResult } from '../../orderTypes';

export default class UpdateBillingAddress {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: { address: Address; operationId: string }): Promise<EditResult> {
    return this.gateway.updateBillingAddress(id, input);
  }
}
