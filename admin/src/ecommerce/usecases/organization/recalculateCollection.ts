import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';

export default class RecalculateCollection {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number): Promise<{ added: number; removed: number }> {
    return this.gateway.recalculateCollection(id);
  }
}
