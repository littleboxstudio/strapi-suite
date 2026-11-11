import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';

export default class FetchShipmentLabel {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(shipmentId: number): Promise<Blob> {
    return this.gateway.fetchShipmentLabel(shipmentId);
  }
}
