import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { StoreCredit } from '../../orderTypes';

export default class VoidStoreCredit {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<StoreCredit> {
    return this.gateway.voidStoreCredit(id);
  }
}
