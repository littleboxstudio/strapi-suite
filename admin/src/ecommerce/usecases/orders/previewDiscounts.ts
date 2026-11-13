import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { DiscountRecalculation } from '../../orderTypes';

export default class PreviewDiscounts {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: { selection?: string[] }): Promise<DiscountRecalculation> {
    return this.gateway.previewDiscounts(id, input);
  }
}
