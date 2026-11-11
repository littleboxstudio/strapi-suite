import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';

export default class FetchInvoicePdf {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(invoiceId: number): Promise<Blob> {
    return this.gateway.fetchInvoicePdf(invoiceId);
  }
}
