import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShipmentView } from '../../orderTypes';

export default class CancelShipment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number, reason?: string): Promise<ShipmentView> {
    return this.gateway.cancelShipment(shipmentId, reason);
  }
}
