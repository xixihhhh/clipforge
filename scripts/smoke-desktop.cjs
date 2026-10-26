// Run after pnpm build && pnpm bundle:standalone:
// pnpm exec electron scripts/smoke-desktop.cjs /absolute/temporary/user-data write
// pnpm exec electron scripts/smoke-desktop.cjs /absolute/temporary/user-data read
// Uses only the explicit test profile, never the user's actual desktop settings.
const { app } = require("electron");
const { resolve, isAbsolute, join } = require("path");
const { mkdirSync } = require("fs");
const [profile, mode] = process.argv.slice(2);
if (!profile || !isAbsolute(profile) || !["write", "read"].includes(mode)) throw new Error("Pass an absolute temporary profile and write/read mode");
mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
if (mode === "write") {
  const { createSettingsStorage } = require("../electron/settings-storage.cjs");
  const storage = createSettingsStorage(join(profile, "data", "settings"));
  for (const name of ["settings", "brand", "characters", "products", "templates"]) {
    storage.setItem(`daihuo-jianshou-${name}`, JSON.stringify({ state: { smokeMarker: "persisted" }, version: name === "settings" ? 5 : 0 }));
  }
}
function fail(error) {
  console.error("DESKTOP_SMOKE_FAILED", error);
  app.emit("before-quit");
  app.exit(1);
}
let loads = 0;
const timeout = setTimeout(() => fail(new Error("Desktop smoke timed out")), 45000);
app.on("browser-window-created", (_event, window) => {
  window.hide();
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const storage = window.clipforgeStorage;
        if (!storage) throw new Error('Missing preload bridge');
        const keys = ['settings', 'brand', 'characters', 'products', 'templates'].map(k => 'daihuo-jianshou-' + k);
        for (const key of keys) storage.setItem(key, storage.getItem(key));
        for (const key of keys) if (JSON.parse(storage.getItem(key) || '{}').state?.smokeMarker !== 'persisted') throw new Error('Lost store: ' + key);
        const health = await (await fetch('/api/health')).json();
        if (health.db.status !== 'ok') throw new Error(health.db.status);
        return { origin: location.origin, stores: keys.length, database: health.db.status };
      })()`);
      console.log("DESKTOP_SMOKE", JSON.stringify({ mode, load: ++loads, ...result }));
      if (loads === 1 && process.platform === "darwin") {
        window.once("closed", () => setImmediate(() => app.emit("activate")));
        window.close();
      } else {
        clearTimeout(timeout);
        app.quit();
      }
    } catch (error) {
      clearTimeout(timeout);
      fail(error);
    }
  });
});
require(resolve(__dirname, "../electron/main.js"));
