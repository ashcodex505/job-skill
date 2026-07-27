/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once —
 * a fixed number of lanes, each pulling the next unclaimed item off a shared
 * queue as soon as it finishes its current one. Safe without locking: JS's
 * single-threaded event loop never interleaves the synchronous `index++`,
 * so two lanes can never claim the same item.
 */
export async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function lane(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}
