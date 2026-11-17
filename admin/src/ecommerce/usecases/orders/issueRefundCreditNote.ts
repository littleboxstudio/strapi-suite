import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { InvoiceView, RefundCreditNoteInput } from '../../orderTypes';

export default class IssueRefundCreditNote {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(refundId: number, input: RefundCreditNoteInput): Promise<InvoiceView> {
    return this.gateway.issueRefundCreditNote(refundId, input);
  }
}
