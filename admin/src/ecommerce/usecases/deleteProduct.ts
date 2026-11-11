import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';

/** Deletes a product that was never ordered (the server answers 409 PRODUCT_IN_ORDERS otherwise). */
export default class DeleteProduct {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number): Promise<void> {
    return this.gateway.deleteProduct(id);
  }
}
