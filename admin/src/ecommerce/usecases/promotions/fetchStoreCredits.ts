import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { Paginated, StoreCredit } from '../../orderTypes';
import type { PromotionListParams } from '../../promotionTypes';

export default class FetchStoreCredits {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(params: PromotionListParams = {}): Promise<Paginated<StoreCredit>> {
    return this.gateway.fetchStoreCredits(params);
  }
}
