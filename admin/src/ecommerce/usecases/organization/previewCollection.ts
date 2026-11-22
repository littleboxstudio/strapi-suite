import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CollectionPreviewInput, CollectionPreviewItem, Paginated } from '../../organizationTypes';

export default class PreviewCollection {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(input: CollectionPreviewInput): Promise<Paginated<CollectionPreviewItem>> {
    return this.gateway.previewCollection(input);
  }
}
