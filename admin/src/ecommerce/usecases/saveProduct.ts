import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { ProductInput } from '../types';

export default class SaveProduct {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  // Creates when `id` is undefined, updates otherwise. Resolves to the product id.
  async execute(id: number | undefined, input: ProductInput): Promise<number> {
    if (id === undefined) {
      const { id: created } = await this.gateway.createProduct(input);
      return created;
    }
    await this.gateway.updateProduct(id, input);
    return id;
  }
}
