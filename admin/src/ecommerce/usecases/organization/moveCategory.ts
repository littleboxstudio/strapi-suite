import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CategoryMoveInput } from '../../organizationTypes';

export default class MoveCategory {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number, input: CategoryMoveInput): Promise<void> {
    return this.gateway.moveCategory(id, input);
  }
}
