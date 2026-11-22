import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CollectionListItem, CollectionListParams, Paginated } from '../../organizationTypes';

export default class FetchCollections {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(params: CollectionListParams = {}): Promise<Paginated<CollectionListItem>> {
    return this.gateway.fetchCollections(params);
  }
}
