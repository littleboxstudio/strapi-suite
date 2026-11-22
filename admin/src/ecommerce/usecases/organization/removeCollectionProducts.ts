import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';

export default class RemoveCollectionProducts {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number, productIds: number[]): Promise<void> {
    return this.gateway.removeCollectionProducts(id, productIds);
  }
}
