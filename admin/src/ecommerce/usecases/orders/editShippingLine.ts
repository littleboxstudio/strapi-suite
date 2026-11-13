import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, ShippingLineInput } from '../../orderTypes';

export default class EditShippingLine {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, lineId: number, input: ShippingLineInput & { operationId: string }): Promise<EditResult> {
    return this.gateway.editShippingLine(id, lineId, input);
  }
}
