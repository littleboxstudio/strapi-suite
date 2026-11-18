import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { PromotionCodeSearchResult } from '../../orderTypes';

export default class SearchPromotionCodes {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(q: string): Promise<PromotionCodeSearchResult[]> {
    return (await this.gateway.searchPromotionCodes(q)).results;
  }
}
