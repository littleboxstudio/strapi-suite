import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { NamedListParams, NamedPage } from '../../organizationTypes';

export default class FetchTags {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(params: NamedListParams = {}): Promise<NamedPage> {
    return this.gateway.fetchTags(params);
  }
}
