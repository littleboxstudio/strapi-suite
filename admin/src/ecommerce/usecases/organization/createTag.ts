import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { NamedInput } from '../../organizationTypes';

export default class CreateTag {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(input: NamedInput): Promise<{ id: number }> {
    return this.gateway.createTag(input);
  }
}
