import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { LookupResult } from '../../settingsTypes';

export default class FetchIntegrationLookups {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  /** `companyId` selects the company-specific lists (Moloni); without it only the companies. */
  async execute(id: string, companyId?: string): Promise<LookupResult> {
    return this.gateway.fetchIntegrationLookups(id, companyId);
  }
}
