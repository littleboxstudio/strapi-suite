import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { NotificationView } from '../../orderTypes';

export default class FetchOrderNotifications {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number): Promise<NotificationView[]> {
    return this.gateway.fetchOrderNotifications(orderId);
  }
}
