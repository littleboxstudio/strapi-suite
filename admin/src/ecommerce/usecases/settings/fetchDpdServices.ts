import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { DpdServices } from '../../settingsTypes';

export default class FetchDpdServices {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<DpdServices> {
    return this.gateway.fetchDpdServices();
  }
}
