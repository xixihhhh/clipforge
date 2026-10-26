// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it } from "vitest";
const { createSettingsStorage } = createRequire(import.meta.url)("../../../electron/settings-storage.cjs");
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "clipforge-settings-")); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it("keeps all five stores across process/storage restarts (#39)", () => {
  const first = createSettingsStorage(directory);
  for (const name of ["settings", "brand", "characters", "products", "templates"]) {
    first.setItem(`daihuo-jianshou-${name}`, JSON.stringify({ state: { value: name }, version: 5 }));
  }
  const second = createSettingsStorage(directory);
  for (const name of ["settings", "brand", "characters", "products", "templates"]) {
    expect(JSON.parse(second.getItem(`daihuo-jianshou-${name}`)).state.value).toBe(name);
  }
  expect(readdirSync(directory)).toHaveLength(5);
});
it("rejects invalid keys/JSON without damaging saved settings", () => {
  const storage = createSettingsStorage(directory);
  const key = "daihuo-jianshou-settings";
  storage.setItem(key, '{"state":{"value":1}}');
  expect(() => storage.setItem(key, "invalid")).toThrow();
  expect(() => storage.setItem("../../escape", "{}")).toThrow();
  expect(JSON.parse(readFileSync(join(directory, `${key}.json`), "utf8")).state.value).toBe(1);
  storage.removeItem(key);
  expect(storage.getItem(key)).toBeNull();
});
