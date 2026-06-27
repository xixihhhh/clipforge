/**
 * 轻量 TTL + LRU 缓存（无依赖、可单测）。
 * 用于聚合素材检索等「短时间内同 key 重复请求」的场景，避免重复打第三方 API / 撞限流。
 * 注入 `now` 便于测 TTL 过期（默认 Date.now）。
 */
export class TtlCache<V> {
  private m = new Map<string, { at: number; v: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.m.delete(key);
      return undefined;
    }
    // LRU：命中移到末尾（Map 保留插入序，删除淘汰最久未用的）
    this.m.delete(key);
    this.m.set(key, e);
    return e.v;
  }

  set(key: string, v: V): void {
    this.m.delete(key);
    this.m.set(key, { at: this.now(), v });
    if (this.m.size > this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }

  get size(): number {
    return this.m.size;
  }

  clear(): void {
    this.m.clear();
  }
}
