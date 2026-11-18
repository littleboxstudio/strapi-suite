import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ApplicablePromotions, ApplicablePromotionsInput } from '../../orderTypes';

export default class FetchApplicablePromotions {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: ApplicablePromotionsInput): Promise<ApplicablePromotions> {
    return this.gateway.applicablePromotions(input);
  }
}
