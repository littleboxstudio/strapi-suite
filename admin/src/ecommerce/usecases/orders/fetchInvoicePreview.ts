import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { InvoicePreview, InvoiceScopeInput } from '../../orderTypes';

export default class FetchInvoicePreview {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, scope: InvoiceScopeInput): Promise<InvoicePreview> {
    return this.gateway.fetchInvoicePreview(orderId, scope);
  }
}
