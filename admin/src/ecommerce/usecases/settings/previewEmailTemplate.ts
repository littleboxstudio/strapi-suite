import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EmailPreview, EmailTemplateType, TemplateContent } from '../../settingsTypes';

export default class PreviewEmailTemplate {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(type: EmailTemplateType, content: TemplateContent): Promise<EmailPreview> {
    return this.gateway.previewEmailTemplate(type, content);
  }
}
