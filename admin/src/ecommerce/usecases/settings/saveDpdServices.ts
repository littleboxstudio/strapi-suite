import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { DpdServices, DpdServicesSaveResult } from '../../settingsTypes';

export default class SaveDpdServices {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(services: DpdServices): Promise<DpdServicesSaveResult> {
    return this.gateway.saveDpdServices(services);
  }
}
