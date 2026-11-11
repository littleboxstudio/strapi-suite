import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { Promotion } from '../../promotionTypes';

export default class FetchPromotion {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(id: number): Promise<Promotion> {
    return this.gateway.fetchPromotion(id);
  }
}
