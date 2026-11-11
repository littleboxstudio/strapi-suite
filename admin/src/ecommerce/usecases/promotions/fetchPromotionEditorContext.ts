import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { PromotionEditorContext } from '../../promotionTypes';

/** Locales and store time zone for the promotion editor. */
export default class FetchPromotionEditorContext {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(): Promise<PromotionEditorContext> {
    return this.gateway.fetchEditorContext();
  }
}
