import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { Paginated } from '../../orderTypes';
import type { PromotionRedemption } from '../../promotionTypes';

export default class FetchPromotionRedemptions {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(id: number, page?: number): Promise<Paginated<PromotionRedemption>> {
    return this.gateway.fetchRedemptions(id, page);
  }
}
