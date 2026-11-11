import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';

/** Enables or disables a saved variant right away (no full product save). */
export default class SetVariantActive {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number, active: boolean): Promise<{ active: boolean }> {
    return this.gateway.setVariantActive(id, active);
  }
}
