import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';

export default class DeletePromotion {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(id: number): Promise<{ ok: true }> {
    return this.gateway.deletePromotion(id);
  }
}
