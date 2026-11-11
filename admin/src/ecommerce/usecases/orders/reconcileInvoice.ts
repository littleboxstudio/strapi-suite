import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { InvoiceView } from '../../orderTypes';

export default class ReconcileInvoice {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(invoiceId: number, markFailed = false): Promise<InvoiceView> {
    return this.gateway.reconcileInvoice(invoiceId, markFailed);
  }
}
