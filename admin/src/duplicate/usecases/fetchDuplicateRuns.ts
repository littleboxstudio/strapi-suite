import Registry from '../../core/di/registry';
import DuplicateGateway from '../gateway';
import type { DuplicateRun } from '../gateway';

export default class FetchDuplicateRuns {
  gateway: DuplicateGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('duplicateGateway');
  }

  async execute(): Promise<DuplicateRun[]> {
    return this.gateway.fetchRuns();
  }
}
