import { describe, expect, it } from 'vitest';
import { createSemaphore } from '../../../../../server/src/services/modules/ecommerce/domain/accounts/semaphore';
import { EcommerceRateLimitError } from '../../../../../server/src/services/modules/ecommerce/errors';

describe('createSemaphore', () => {
  it('runs 4, queues 16, rejects the 21st, and drains in order', async () => {
    const sem = createSemaphore(4, 16);
    const started: number[] = [];
    const gates: Array<() => void> = [];
    const task = (i: number) =>
      sem.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(i);
            gates.push(() => resolve(i));
          })
      );
    const calls = Array.from({ length: 20 }, (_, i) => task(i));
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3]);

    const err = await task(20).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceRateLimitError);
    expect(err.retryAfterSec).toBe(1);

    for (let n = 0; n < 20; n += 1) {
      while (gates.length <= n) await new Promise((r) => setImmediate(r));
      gates[n]();
      await new Promise((r) => setImmediate(r));
    }
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(started).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
  it('frees the slot when a task throws', async () => {
    const sem = createSemaphore(1, 0);
    await expect(sem.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(sem.run(async () => 5)).resolves.toBe(5);
  });
});
