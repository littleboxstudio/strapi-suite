import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StorefrontApiToken } from '../../settingsTypes';

export default class FetchApiTokens {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<StorefrontApiToken[]> {
    return this.gateway.fetchApiTokens();
  }
}
