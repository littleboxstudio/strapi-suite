import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { InvoiceView, IssueInvoiceInput } from '../../orderTypes';

export default class IssueInvoice {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: IssueInvoiceInput): Promise<InvoiceView> {
    return this.gateway.issueInvoice(orderId, input);
  }
}
