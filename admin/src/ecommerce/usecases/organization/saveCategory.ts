import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CategoryInput } from '../../organizationTypes';

/** Creates (no id) or updates a category; answers its id. */
export default class SaveCategory {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(input: CategoryInput, id?: number): Promise<{ id: number }> {
    if (id === undefined) return this.gateway.createCategory(input);
    await this.gateway.updateCategory(id, input);
    return { id };
  }
}
