import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { TranslateInput, TranslateOutput } from '../types';

export default class TranslateProductStrings {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(input: TranslateInput): Promise<TranslateOutput> {
    return this.gateway.translate(input);
  }
}
