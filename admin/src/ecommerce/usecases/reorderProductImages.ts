import Registry from '../../core/di/registry';
import EcommerceProductGateway from '../gateways/ecommerceProductGateway';
import type { ImageOwner } from '../utils/imageUpload';

/** Saves a gallery's order (every image id, first to last); returns the gallery's cover. */
export default class ReorderProductImages {
  gateway: EcommerceProductGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceProductGateway');
  }

  async execute(owner: ImageOwner, ids: number[]): Promise<{ coverId: number | null }> {
    return this.gateway.reorderImages(owner, ids);
  }
}
