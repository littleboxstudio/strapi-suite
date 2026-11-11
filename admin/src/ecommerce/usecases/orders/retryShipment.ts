import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { ShipmentView } from '../../orderTypes';

export default class RetryShipment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number): Promise<ShipmentView> {
    return this.gateway.retryShipment(shipmentId);
  }
}
