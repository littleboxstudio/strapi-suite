import Registry from '../../../core/di/registry';
import EcommercePromotionsGateway from '../../gateways/ecommercePromotionsGateway';
import type { StoreCredit } from '../../orderTypes';
import type { StoreCreditMovement } from '../../promotionTypes';

/** One store credit with its ledger of movements. */
export default class FetchStoreCredit {
  gateway: EcommercePromotionsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommercePromotionsGateway');
  }

  async execute(id: number): Promise<StoreCredit & { movements: StoreCreditMovement[] }> {
    return this.gateway.fetchStoreCredit(id);
  }
}
