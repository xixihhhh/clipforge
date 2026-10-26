const fs = require("fs");
const path = require("path");

const KEYS = new Set(["settings", "brand", "characters", "products", "templates"].map((key) => `daihuo-jianshou-${key}`));

/** One atomic JSON file per store, independent of the server's ephemeral port. */
function createSettingsStorage(directory) {
  function fileFor(key) {
    if (!KEYS.has(key)) throw new Error("Unknown settings key");
    return path.join(directory, `${key}.json`);
  }
  return {
    getItem(key) {
      try {
        const value = fs.readFileSync(fileFor(key), "utf8");
        JSON.parse(value); // A corrupt file must not silently be overwritten with defaults.
        return value;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    setItem(key, value) {
      const file = fileFor(key);
      if (typeof value !== "string") throw new Error("Invalid settings value");
      JSON.parse(value);
      if (fs.existsSync(file)) JSON.parse(fs.readFileSync(file, "utf8"));
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, value, { mode: 0o600, flush: true });
      fs.renameSync(temporary, file);
    },
    removeItem(key) {
      fs.rmSync(fileFor(key), { force: true });
    },
  };
}

module.exports = { createSettingsStorage };
