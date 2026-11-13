import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, ShippingLineInput } from '../../orderTypes';

export default class AddShippingLine {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: ShippingLineInput & { operationId: string }): Promise<EditResult> {
    return this.gateway.addShippingLine(id, input);
  }
}
