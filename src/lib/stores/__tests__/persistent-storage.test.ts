import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPersistentStorage, persistentStorage } from "../persistent-storage";
beforeEach(() => localStorage.clear());
afterEach(() => { delete window.clipforgeStorage; vi.restoreAllMocks(); });
it("migrates the current browser store once and prioritizes desktop data", () => {
  const disk = new Map<string, string>();
  window.clipforgeStorage = {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => { disk.set(key, value); },
    removeItem: (key) => { disk.delete(key); },
  };
  localStorage.setItem("settings", '{"state":{"apiKey":"legacy"}}');
  expect(persistentStorage.getItem("settings")).toContain("legacy");
  localStorage.clear(); // New local server port has no browser storage.
  expect(persistentStorage.getItem("settings")).toContain("legacy");
  persistentStorage.setItem("settings", '{"state":{"apiKey":"updated"}}');
  expect(localStorage.getItem("settings")).toBeNull();
  expect(persistentStorage.getItem("settings")).toContain("updated");
});
it("retains date revival and browser persistence on web installs", async () => {
  const storage = createPersistentStorage<{ products: { createdAt: Date }[] }>()!;
  const value = { state: { products: [{ createdAt: new Date("2026-10-01T00:00:00Z") }] }, version: 1 };
  storage.setItem("products", value);
  expect(await storage.getItem("products")).toEqual(value);
});
it("surfaces disk failures rather than pretending browser fallback was durable", () => {
  window.clipforgeStorage = { getItem: () => null, setItem: () => { throw new Error("disk full"); }, removeItem: () => {} };
  expect(() => persistentStorage.setItem("settings", "{}")).toThrow("disk full");
  expect(localStorage.getItem("settings")).toBeNull();
});
