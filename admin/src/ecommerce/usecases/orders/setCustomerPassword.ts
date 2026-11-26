import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';

export default class SetCustomerPassword {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, password: string): Promise<void> {
    return this.gateway.setCustomerPassword(id, password);
  }
}
