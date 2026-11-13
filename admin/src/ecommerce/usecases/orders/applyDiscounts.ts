import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult } from '../../orderTypes';

export default class ApplyDiscounts {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: { selection: string[]; operationId: string }): Promise<EditResult> {
    return this.gateway.applyDiscounts(id, input);
  }
}
