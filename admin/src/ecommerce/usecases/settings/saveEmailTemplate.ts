import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateType, EmailTemplateView, TemplateContent } from '../../settingsTypes';

export default class SaveEmailTemplate {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, locale: string, content: TemplateContent): Promise<EmailTemplateView> {
    return this.gateway.saveEmailTemplate(type, locale, content);
  }
}
