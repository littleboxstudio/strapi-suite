import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CategoryDetail } from '../../organizationTypes';

export default class FetchCategory {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number): Promise<CategoryDetail> {
    return this.gateway.fetchCategory(id);
  }
}
