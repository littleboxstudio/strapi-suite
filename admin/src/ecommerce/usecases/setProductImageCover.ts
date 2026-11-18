import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';

/** Marks an image as its gallery's cover; the previous cover stops being one. */
export default class SetProductImageCover {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number): Promise<void> {
    return this.gateway.setImageCover(id);
  }
}
