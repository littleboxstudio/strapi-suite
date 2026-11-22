import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CollectionInput } from '../../organizationTypes';

/** Creates (no id) or updates a collection; answers its id. */
export default class SaveCollection {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(input: CollectionInput, id?: number): Promise<{ id: number }> {
    if (id === undefined) return this.gateway.createCollection(input);
    await this.gateway.updateCollection(id, input);
    return { id };
  }
}
