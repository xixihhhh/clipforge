import { describe, it, expect } from "vitest";
import { createLimiter } from "@/lib/concurrency";

/** Resolvable gate: lets the test control exactly when each task finishes */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

describe("createLimiter", () => {
  it("同时在飞不超过 max（且确实并发）", async () => {
    const run = createLimiter(3);
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        run(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return i * 2;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => i * 2)); // each caller gets its own result
    expect(maxInFlight).toBeLessThanOrEqual(3); // never exceeds the cap
    expect(maxInFlight).toBeGreaterThan(1); // actually concurrent (not serialised)
  });

  it("FIFO：排队任务按提交顺序启动", async () => {
    const run = createLimiter(1);
    const started: number[] = [];
    const first = gate();
    // occupy the single slot, then queue 3 more while it is held
    const p0 = run(async () => {
      started.push(0);
      await first.p;
    });
    const rest = [1, 2, 3].map((i) =>
      run(async () => {
        started.push(i);
      }),
    );
    // flush microtasks: task bodies start on the microtask queue, not synchronously
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0]); // queued tasks have not started while the slot is held
    first.open();
    await Promise.all([p0, ...rest]);
    expect(started).toEqual([0, 1, 2, 3]); // strict submission order
  });

  it("任务 reject 会释放槽位（容量不泄漏）", async () => {
    const run = createLimiter(1);
    const boom = run(async () => {
      throw new Error("boom");
    });
    await expect(boom).rejects.toThrow("boom"); // rejection propagates to the caller
    // slot must be free again: the next task runs to completion
    await expect(run(async () => "ok")).resolves.toBe("ok");
  });

  it("同步 throw 也走 reject 并释放槽位", async () => {
    const run = createLimiter(1);
    await expect(
      run(() => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    await expect(run(() => 42)).resolves.toBe(42); // sync return values also supported
  });

  it("max=1 时严格串行", async () => {
    const run = createLimiter(1);
    let inFlight = 0;
    let maxInFlight = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        run(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight--;
        }),
      ),
    );
    expect(maxInFlight).toBe(1);
  });

  it("非法 max（0/负数/NaN）钳到至少 1，不会卡死", async () => {
    for (const bad of [0, -3, NaN]) {
      const run = createLimiter(bad);
      await expect(run(async () => "done")).resolves.toBe("done");
    }
  });
});
