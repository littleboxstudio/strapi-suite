import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { StoreSettings } from '../../settingsTypes';

export default class UploadStoreLogo {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(form: FormData): Promise<StoreSettings> {
    return this.gateway.uploadStoreLogo(form);
  }
}
