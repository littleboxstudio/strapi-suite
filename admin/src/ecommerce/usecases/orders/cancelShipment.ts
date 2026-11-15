import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CancelledShipmentView } from '../../orderTypes';

export default class CancelShipment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number, reason?: string): Promise<CancelledShipmentView> {
    return this.gateway.cancelShipment(shipmentId, reason);
  }
}
