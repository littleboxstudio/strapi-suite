import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { Promotion, PromotionSaveInput } from '../../promotionTypes';

/** Creates the promotion, or updates it (with the `version` it was loaded with) when `id` is given. */
export default class SavePromotion {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(input: PromotionSaveInput, id?: number): Promise<Promotion> {
    return id === undefined ? this.gateway.createPromotion(input) : this.gateway.updatePromotion(id, input);
  }
}
