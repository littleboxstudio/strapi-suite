import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { ConnectionResult } from '../../settingsTypes';

export default class TestIntegration {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(id: string): Promise<ConnectionResult> {
    return this.gateway.testIntegration(id);
  }
}
