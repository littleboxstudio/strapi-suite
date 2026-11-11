import Registry from '../../../core/di/registry';
import EcommerceSettingsGateway from '../../gateways/ecommerceSettingsGateway';
import type { EcommerceLocales } from '../../types';

/** Locales for the settings screens (needs only the settings read permission). */
export default class FetchSettingsLocales {
  gateway: EcommerceSettingsGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceSettingsGateway');
  }

  async execute(): Promise<EcommerceLocales> {
    return this.gateway.fetchLocales();
  }
}
