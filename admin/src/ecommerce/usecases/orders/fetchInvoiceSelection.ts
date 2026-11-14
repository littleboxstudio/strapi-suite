import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { InvoiceSelectionView } from '../../orderTypes';

export default class FetchInvoiceSelection {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number): Promise<InvoiceSelectionView> {
    return this.gateway.fetchInvoiceSelection(orderId);
  }
}
