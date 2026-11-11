import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ApplyModificationInput, ModificationApplied } from '../../orderTypes';

export default class ApplyOrderModification {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: ApplyModificationInput): Promise<ModificationApplied> {
    return this.gateway.applyModification(id, input);
  }
}
