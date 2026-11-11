import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { PromotionCatalogResult } from '../../promotionTypes';

export default class SearchPromotionCatalog {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(q: string, locale?: string): Promise<PromotionCatalogResult[]> {
    return this.gateway.searchCatalog(q, locale);
  }
}
