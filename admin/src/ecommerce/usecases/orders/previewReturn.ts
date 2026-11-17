import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RegisterReturnInput, ReturnPreview } from '../../orderTypes';

/** What registering a return of `lines` would give back; nothing is written. */
export default class PreviewReturn {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, lines: RegisterReturnInput['lines']): Promise<ReturnPreview> {
    return this.gateway.previewReturn(orderId, lines);
  }
}
