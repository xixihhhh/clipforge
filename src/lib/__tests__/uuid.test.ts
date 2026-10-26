import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "@/lib/uuid";

afterEach(() => vi.unstubAllGlobals());
describe("HTTP LAN UUIDs (#34)", () => {
  it("uses secure random bytes when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 100 }, randomUUID);
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
