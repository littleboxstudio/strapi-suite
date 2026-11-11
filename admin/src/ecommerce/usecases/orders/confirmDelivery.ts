import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { DeliveryInput, ShipmentView } from '../../orderTypes';

export default class ConfirmDelivery {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number, input: DeliveryInput): Promise<ShipmentView> {
    return this.gateway.confirmDelivery(shipmentId, input);
  }
}
