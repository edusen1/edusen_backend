/**
 * Executes I/O work with a fixed upper bound. This protects the Prisma pool and
 * external providers when a school processes a whole class at once.
 */
export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('La concurrence doit etre un entier superieur ou egal a 1.');
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await task(items[index], index);
      }
    }),
  );

  return results;
}

/** A small FIFO semaphore for memory-heavy asynchronous operations. */
export class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('La limite doit etre un entier superieur ou egal a 1.');
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}
