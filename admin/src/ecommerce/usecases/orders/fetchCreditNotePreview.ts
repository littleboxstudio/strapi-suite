import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CreditNotePreview } from '../../orderTypes';

export default class FetchCreditNotePreview {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(invoiceId: number): Promise<CreditNotePreview> {
    return this.gateway.fetchCreditNotePreview(invoiceId);
  }
}
