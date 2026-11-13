import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingRecalculationPreview } from '../../orderTypes';

export default class PreviewShippingRecalculation {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<ShippingRecalculationPreview> {
    return this.gateway.previewShippingRecalculation(id);
  }
}
