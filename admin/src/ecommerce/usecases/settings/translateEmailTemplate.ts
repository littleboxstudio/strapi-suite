import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { TranslateInput, TranslateOutput } from '../../types';

/** Translates an e-mail template's strings with AI (the products' translation engine). */
export default class TranslateEmailTemplate {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(input: TranslateInput): Promise<TranslateOutput> {
    return this.gateway.translateEmailTemplate(input);
  }
}
