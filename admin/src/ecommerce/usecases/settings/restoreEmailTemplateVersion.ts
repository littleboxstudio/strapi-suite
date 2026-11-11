import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailTemplateType, EmailTemplateView } from '../../settingsTypes';

export default class RestoreEmailTemplateVersion {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, locale: string, versionId: number): Promise<EmailTemplateView> {
    return this.gateway.restoreEmailTemplateVersion(type, locale, versionId);
  }
}
