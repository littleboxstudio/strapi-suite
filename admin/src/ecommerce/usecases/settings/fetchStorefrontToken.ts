import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StorefrontTokenState } from '../../settingsTypes';

export default class FetchStorefrontToken {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<StorefrontTokenState> {
    return this.gateway.fetchStorefrontToken();
  }
}
