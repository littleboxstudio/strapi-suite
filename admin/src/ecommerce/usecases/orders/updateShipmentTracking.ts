import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShipmentView, TrackingInput } from '../../orderTypes';

export default class UpdateShipmentTracking {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number, input: TrackingInput): Promise<ShipmentView> {
    return this.gateway.updateTracking(shipmentId, input);
  }
}
