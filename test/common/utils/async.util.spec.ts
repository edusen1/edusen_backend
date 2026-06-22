import { AsyncSemaphore, mapWithConcurrency } from '@/common/utils/async.util';

describe('mapWithConcurrency', () => {
  it('preserves item order and enforces the requested concurrency limit', async () => {
    let running = 0;
    let maximum = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running += 1;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maximum).toBe(2);
  });

  it('rejects an invalid concurrency value', async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });
});

describe('AsyncSemaphore', () => {
  it('queues memory-heavy work without exceeding its capacity', async () => {
    const semaphore = new AsyncSemaphore(1);
    const order: string[] = [];

    await Promise.all([
      semaphore.run(async () => {
        order.push('first:start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('first:end');
      }),
      semaphore.run(async () => {
        order.push('second:start');
        order.push('second:end');
      }),
    ]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
