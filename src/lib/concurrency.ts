/**
 * Bounded-concurrency map (no dependencies, order-preserving, unit-testable).
 * Uses `limit` workers that each pull the next item in turn, avoiding a thundering-herd
 * against downstream APIs / connection pools while still being faster than serial execution.
 * Results are returned in input order (results[idx]). If any fn throws, the whole call rejects.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** A function that schedules `fn` through a shared concurrency gate and resolves/rejects with its result */
export type Limiter = <T>(fn: () => Promise<T> | T) => Promise<T>;

/**
 * Create a reusable FIFO concurrency limiter: at most `max` tasks run at once,
 * the rest wait in submission order. Unlike mapWithConcurrency (one-shot batch),
 * the returned function is long-lived — independent callers (e.g. concurrent API
 * requests) can share one limiter to gate an expensive resource such as ffmpeg.
 * Both resolution and rejection release the slot, so a failed task never leaks capacity.
 */
export function createLimiter(max: number): Limiter {
  const limit = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  // pending task starters, dequeued in FIFO order as slots free up
  const queue: Array<() => void> = [];

  function release(): void {
    active--;
    const next = queue.shift();
    if (next) next();
  }

  return function schedule<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        // Promise.resolve().then(fn) also catches synchronous throws from fn
        Promise.resolve().then(fn).then(
          (value) => {
            release();
            resolve(value);
          },
          (err) => {
            release(); // rejection must free the slot too, or capacity leaks away
            reject(err);
          },
        );
      };
      if (active < limit) start();
      else queue.push(start);
    });
  };
}
