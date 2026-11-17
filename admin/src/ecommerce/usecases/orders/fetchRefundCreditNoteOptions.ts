import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RefundCreditNoteOptions } from '../../orderTypes';

export default class FetchRefundCreditNoteOptions {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(refundId: number): Promise<RefundCreditNoteOptions> {
    return this.gateway.fetchRefundCreditNoteOptions(refundId);
  }
}
