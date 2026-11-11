import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';


export default class DeleteProductImage {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(id: number): Promise<void> {
    return this.gateway.deleteImage(id);
  }
}
