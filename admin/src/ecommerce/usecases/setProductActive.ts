import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';

/** Enables or disables a saved product right away (no full save). */
export default class SetProductActive {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number, active: boolean): Promise<{ active: boolean }> {
    return this.gateway.setProductActive(id, active);
  }
}
