import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShippingRecalculationInput, ShippingRecalculationPreview } from '../../orderTypes';

export default class PreviewShippingRecalculation {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input?: ShippingRecalculationInput): Promise<ShippingRecalculationPreview> {
    return this.gateway.previewShippingRecalculation(id, input);
  }
}
