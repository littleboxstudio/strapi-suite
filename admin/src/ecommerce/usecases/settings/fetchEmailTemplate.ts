import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateType, EmailTemplateView } from '../../settingsTypes';

export default class FetchEmailTemplate {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, locale: string): Promise<EmailTemplateView> {
    return this.gateway.fetchEmailTemplate(type, locale);
  }
}
