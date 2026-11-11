import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { ImageRecord } from '../types';

export default class UploadProductImage {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(form: FormData): Promise<ImageRecord> {
    return this.gateway.uploadImage(form);
  }
}
