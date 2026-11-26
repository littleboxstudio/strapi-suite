import { EcommerceRateLimitError } from '../../errors';

/** At most `max` tasks run at once and `queue` wait; further calls reject. The queue drains in order. */
export const createSemaphore = (max: number, queue: number) => {
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight to the next waiter
    else running -= 1;
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (running < max) {
        running += 1;
      } else if (waiting.length < queue) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        throw new EcommerceRateLimitError(1);
      }
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
};
