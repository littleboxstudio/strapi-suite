import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';

export default class DeleteCategory {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number): Promise<void> {
    return this.gateway.deleteCategory(id);
  }
}
