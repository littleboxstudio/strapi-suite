import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { NotificationView } from '../../orderTypes';

export default class ResendNotification {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(notificationId: number): Promise<NotificationView> {
    return this.gateway.resendNotification(notificationId);
  }
}
