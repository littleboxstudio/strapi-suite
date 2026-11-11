import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { VariantSearchResult } from '../../orderTypes';

export default class SearchOrderVariants {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(q: string, locale?: string): Promise<VariantSearchResult[]> {
    return this.gateway.searchVariants(q, locale);
  }
}
