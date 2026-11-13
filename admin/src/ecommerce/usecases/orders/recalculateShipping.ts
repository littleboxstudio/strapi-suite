import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult } from '../../orderTypes';

export default class RecalculateShipping {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: { operationId: string }): Promise<EditResult> {
    return this.gateway.recalculateShipping(id, input);
  }
}
