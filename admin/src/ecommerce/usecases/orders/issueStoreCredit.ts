import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { IssueStoreCreditInput, StoreCredit } from '../../orderTypes';

export default class IssueStoreCredit {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: IssueStoreCreditInput): Promise<StoreCredit> {
    return this.gateway.issueStoreCredit(input);
  }
}
