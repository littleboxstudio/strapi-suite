import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CreateShipmentInput, ShipmentView } from '../../orderTypes';

export default class CreateShipment {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: CreateShipmentInput): Promise<ShipmentView> {
    return this.gateway.createShipment(orderId, input);
  }
}
