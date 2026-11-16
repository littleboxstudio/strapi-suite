import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { StoreCredit, UpdateStoreCreditInput } from '../../orderTypes';

export default class UpdateStoreCredit {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: UpdateStoreCreditInput): Promise<StoreCredit> {
    return this.gateway.updateStoreCredit(id, input);
  }
}
