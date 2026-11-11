import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { IntegrationInput, IntegrationView } from '../../settingsTypes';

export default class UpdateIntegration {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(id: string, input: IntegrationInput): Promise<IntegrationView> {
    return this.gateway.updateIntegration(id, input);
  }
}
