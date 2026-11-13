import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';
import type { EditResult, ReviewFlagCode } from '../../orderTypes';

export default class DismissReviewFlag {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number, code: ReviewFlagCode, input: { operationId: string }): Promise<EditResult> {
    return this.gateway.dismissReviewFlag(id, code, input);
  }
}
