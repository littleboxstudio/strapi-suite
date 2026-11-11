import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { IntegrationView } from '../../settingsTypes';

export default class SetIntegrationActive {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(id: string, active: boolean): Promise<IntegrationView> {
    return this.gateway.setIntegrationActive(id, active);
  }
}
