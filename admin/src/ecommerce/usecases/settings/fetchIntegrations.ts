import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { IntegrationView } from '../../settingsTypes';

export default class FetchIntegrations {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<IntegrationView[]> {
    return this.gateway.fetchIntegrations();
  }
}
