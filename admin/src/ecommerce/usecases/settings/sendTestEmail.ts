import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateType } from '../../settingsTypes';

export default class SendTestEmail {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, locale: string, to: string): Promise<{ id: string }> {
    return this.gateway.sendTestEmail(type, locale, to);
  }
}
