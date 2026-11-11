import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CreditNoteInput, InvoiceView } from '../../orderTypes';

export default class IssueCreditNote {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(invoiceId: number, input: CreditNoteInput): Promise<InvoiceView> {
    return this.gateway.issueCreditNote(invoiceId, input);
  }
}
