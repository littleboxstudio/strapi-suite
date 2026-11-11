import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { Paginated } from '../../orderTypes';
import type { PromotionListItem, PromotionListParams } from '../../promotionTypes';

export default class FetchPromotions {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(params: PromotionListParams = {}): Promise<Paginated<PromotionListItem>> {
    return this.gateway.fetchPromotions(params);
  }
}
