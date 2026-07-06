// After build, fill in the standalone self-contained assets (next build's standalone omits static/public by default),
// copy migration SQL, and replace the better-sqlite3 copy inside standalone with the Electron ABI prebuilt binary.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("✗ 未找到 .next/standalone，请先 next build（需 next.config 开启 output:'standalone'）");
  process.exit(1);
}

const copies = [
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
  [join(root, "drizzle"), join(standalone, "drizzle")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn(`⚠ 跳过(源不存在): ${from}`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`✓ ${from} → ${to}`);
}

// Note: node-linker=hoisted (.npmrc) makes standalone/node_modules a flat, symlink-free tree of real files.
// This is deliberate: the pnpm symlink layout, when reproduced in the standalone, breaks on Windows packaging
// (robocopy follows the links and flattens `next` to the top level, detaching it from its .pnpm peers such as
// @swc/helpers -> MODULE_NOT_FOUND, issue #10). A flat tree copies cleanly on every OS with any copy method.

// === Replace the standalone better-sqlite3 copy with the Electron runtime ABI prebuilt ===
// The copy in the main node_modules keeps the system Node ABI (needed by next build's collect page data step);
// the packaged App runs server.js via Electron's built-in Node fork, which must match Electron's ABI (e.g. Electron 42=146),
// otherwise any DB route will 500 due to NODE_MODULE_VERSION mismatch. Pull the official electron-vXXX prebuilt; do not compile from source.
// Note: `tar` is available on macOS/Linux and on Windows 10+ (bsdtar), so the extract step works on the whole CI matrix.
await rebuildBetterSqlite3ForElectron();

async function rebuildBetterSqlite3ForElectron() {
  // Flat (hoisted) layout: better-sqlite3 lives directly at node_modules/better-sqlite3.
  // Fallback keeps the legacy .pnpm store path in case a build ever runs without node-linker=hoisted.
  let bsDir = join(standalone, "node_modules", "better-sqlite3");
  if (!existsSync(join(bsDir, "package.json"))) {
    const pnpmDir = join(standalone, "node_modules", ".pnpm");
    const bsEntry = existsSync(pnpmDir) ? readdirSync(pnpmDir).find((d) => d.startsWith("better-sqlite3@")) : null;
    if (bsEntry) bsDir = join(pnpmDir, bsEntry, "node_modules", "better-sqlite3");
  }
  if (!existsSync(join(bsDir, "package.json"))) {
    console.warn("⚠ standalone 未找到 better-sqlite3，跳过 Electron ABI 重建");
    return;
  }
  const bsVer = JSON.parse(readFileSync(join(bsDir, "package.json"), "utf8")).version;

  // Ask Electron itself for its module ABI (most reliable; does not depend on node-abi version mapping)
  const electronPath = require("electron"); // returns the absolute path to the Electron executable
  const abi = execSync(`"${electronPath}" -e "process.stdout.write(String(process.versions.modules))"`, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  })
    .toString()
    .trim();

  const plat = process.platform; // darwin / win32 / linux
  const arch = process.arch; // arm64 / x64 / ia32
  const asset = `better-sqlite3-v${bsVer}-electron-v${abi}-${plat}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsVer}/${asset}`;
  console.log(`重建 standalone better-sqlite3 → Electron ABI ${abi}：${asset}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载 Electron 预编译失败 ${res.status}：${url}（确认 better-sqlite3 ${bsVer} 该 release 有 electron-v${abi}-${plat}-${arch} 资产）`);
  }
  const tmp = join(root, ".next", "bs-electron.tar.gz");
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  execSync(`tar -xzf "${tmp}" -C "${bsDir}"`);

  const node = join(bsDir, "build", "Release", "better_sqlite3.node");
  if (!existsSync(node)) throw new Error("解包后未见 better_sqlite3.node，Electron ABI 重建失败");
  console.log("✓ standalone better-sqlite3 已切到 Electron ABI（打包 App 的 DB 路由可用）");
}

console.log("standalone 资源补齐完成");
