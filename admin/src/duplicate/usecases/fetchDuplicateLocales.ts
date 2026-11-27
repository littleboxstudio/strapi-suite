import Registry from '../../core/di/registry';
import DuplicateGateway from '../gateway';
import type { DuplicateLocales } from '../gateway';

export default class FetchDuplicateLocales {
  gateway: DuplicateGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('duplicateGateway');
  }

  async execute(): Promise<DuplicateLocales> {
    return this.gateway.fetchLocales();
  }
}
