import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, LinesInput } from '../../orderTypes';

export default class ApplyOrderLines {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: LinesInput & { operationId: string }): Promise<EditResult> {
    return this.gateway.applyLines(id, input);
  }
}
