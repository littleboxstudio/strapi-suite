import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StripeWebhookInfo } from '../../settingsTypes';

export default class FetchStripeWebhook {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<StripeWebhookInfo> {
    return this.gateway.fetchStripeWebhook();
  }
}
