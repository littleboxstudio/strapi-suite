import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { GeneratedStorefrontToken } from '../../settingsTypes';

export default class GenerateStorefrontToken {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<GeneratedStorefrontToken> {
    return this.gateway.generateStorefrontToken();
  }
}
