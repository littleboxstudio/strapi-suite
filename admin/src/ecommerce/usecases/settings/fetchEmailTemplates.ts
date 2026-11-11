import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateSummary } from '../../settingsTypes';

export default class FetchEmailTemplates {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<EmailTemplateSummary[]> {
    return this.gateway.fetchEmailTemplates();
  }
}
