import Registry from '../../../core/di/registry';
import EcommerceOrganizationGateway from '../../gateways/ecommerceOrganizationGateway';
import type { NamedInput } from '../../organizationTypes';

export default class UpdateTag {
  gateway: EcommerceOrganizationGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrganizationGateway');
  }

  async execute(id: number, input: NamedInput): Promise<void> {
    return this.gateway.updateTag(id, input);
  }
}
