import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ModificationPreview, OrderModificationInput } from '../../orderTypes';

export default class PreviewOrderModification {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: OrderModificationInput): Promise<ModificationPreview> {
    return this.gateway.previewModification(id, input);
  }
}
