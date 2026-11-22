import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CollectionDetail } from '../../organizationTypes';

export default class FetchCollection {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number): Promise<CollectionDetail> {
    return this.gateway.fetchCollection(id);
  }
}
