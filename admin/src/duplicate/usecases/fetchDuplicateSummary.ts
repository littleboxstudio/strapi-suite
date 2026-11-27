import Registry from '../../core/di/registry';
import DuplicateGateway from '../gateway';
import type { DuplicateSummary } from '../gateway';

export default class FetchDuplicateSummary {
  gateway: DuplicateGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('duplicateGateway');
  }

  async execute(targetLocale: string, ecommerce: boolean): Promise<DuplicateSummary> {
    return this.gateway.fetchSummary(targetLocale, ecommerce);
  }
}
