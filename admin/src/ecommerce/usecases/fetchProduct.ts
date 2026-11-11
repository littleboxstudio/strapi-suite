import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { ProductDetail } from '../types';

export default class FetchProduct {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number): Promise<ProductDetail> {
    return this.gateway.fetchProduct(id);
  }
}
