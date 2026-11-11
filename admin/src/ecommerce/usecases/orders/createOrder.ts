import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { CreateOrderInput, CreatedOrder } from '../../orderTypes';

export default class CreateOrder {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(input: CreateOrderInput): Promise<CreatedOrder> {
    return this.gateway.createOrder(input);
  }
}
