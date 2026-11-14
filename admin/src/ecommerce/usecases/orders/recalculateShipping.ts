import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, ShippingRecalculationInput } from '../../orderTypes';

export default class RecalculateShipping {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(
    id: number,
    input: ShippingRecalculationInput & { operationId: string }
  ): Promise<EditResult> {
    return this.gateway.recalculateShipping(id, input);
  }
}
