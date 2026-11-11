import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { EcommerceLocales } from '../types';

export default class FetchEcommerceLocales {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(): Promise<EcommerceLocales> {
    return this.gateway.fetchLocales();
  }
}
