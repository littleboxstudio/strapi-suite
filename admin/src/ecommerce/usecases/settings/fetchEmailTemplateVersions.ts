import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateType, EmailTemplateVersionView } from '../../settingsTypes';

export default class FetchEmailTemplateVersions {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, locale: string): Promise<EmailTemplateVersionView[]> {
    return this.gateway.fetchEmailTemplateVersions(type, locale);
  }
}
