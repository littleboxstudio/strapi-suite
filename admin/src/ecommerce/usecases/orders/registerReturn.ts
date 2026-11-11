import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { RegisterReturnInput, ReturnRegistered } from '../../orderTypes';

export default class RegisterReturn {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(orderId: number, input: RegisterReturnInput): Promise<ReturnRegistered> {
    return this.gateway.registerReturn(orderId, input);
  }
}
