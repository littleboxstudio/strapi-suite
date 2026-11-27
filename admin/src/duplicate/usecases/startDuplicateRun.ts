import Registry from '../../core/di/registry';
import DuplicateGateway from '../gateway';
import type { DuplicateStartInput } from '../gateway';

export default class StartDuplicateRun {
  gateway: DuplicateGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('duplicateGateway');
  }

  async execute(input: DuplicateStartInput): Promise<{ runId: number }> {
    return this.gateway.startRun(input);
  }
}
