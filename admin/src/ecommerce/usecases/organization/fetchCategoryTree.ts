import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { CategoryTreeNode } from '../../organizationTypes';

export default class FetchCategoryTree {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(locale?: string): Promise<CategoryTreeNode[]> {
    return this.gateway.fetchCategoryTree(locale);
  }
}
