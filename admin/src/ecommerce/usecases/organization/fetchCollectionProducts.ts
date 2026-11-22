import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CollectionProductItem, Paginated } from '../../organizationTypes';

export default class FetchCollectionProducts {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number, params: { page?: number; locale?: string } = {}): Promise<Paginated<CollectionProductItem>> {
    return this.gateway.fetchCollectionProducts(id, params);
  }
}
