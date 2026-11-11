import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { ProductListParams, ProductListResult } from '../types';

export default class FetchProducts {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(params: ProductListParams = {}): Promise<ProductListResult> {
    return this.gateway.fetchProducts(params);
  }
}
