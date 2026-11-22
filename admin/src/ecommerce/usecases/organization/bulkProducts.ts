import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { BulkProductsInput } from '../../organizationTypes';

export default class BulkProducts {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(input: BulkProductsInput): Promise<{ updated: number }> {
    return this.gateway.bulkProducts(input);
  }
}
