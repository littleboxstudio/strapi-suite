import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { CronRun } from '../../settingsTypes';

export default class FetchCronRuns {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<CronRun[]> {
    return this.gateway.fetchCronRuns();
  }
}
