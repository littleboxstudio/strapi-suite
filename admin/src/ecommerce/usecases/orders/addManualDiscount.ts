import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, ManualDiscountInput } from '../../orderTypes';

export default class AddManualDiscount {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: ManualDiscountInput & { operationId: string }): Promise<EditResult> {
    return this.gateway.addManualDiscount(id, input);
  }
}
