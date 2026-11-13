import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { LinesInput, LinesPreview } from '../../orderTypes';

export default class PreviewOrderLines {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, input: LinesInput): Promise<LinesPreview> {
    return this.gateway.previewLines(id, input);
  }
}
