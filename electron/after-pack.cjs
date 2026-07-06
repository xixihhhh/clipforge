// electron-builder afterPack hook: copies the entire Next standalone output (including a full node_modules) into the app resources directory.
// Reason: electron-builder's extraResources file collector actively drops node_modules directories,
// leaving standalone/node_modules empty after packaging (next / better-sqlite3 native modules not found → crash on startup).
// The standalone node_modules is a flat, symlink-free tree of real files (node-linker=hoisted in .npmrc), so a plain directory copy
// on any OS reproduces it faithfully — unlike the pnpm symlink layout, which robocopy flattened and broke on Windows (issue #10).
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { createRequire } = require("module");

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productName = packager.appInfo.productFilename;

  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${productName}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  const src = path.join(process.cwd(), ".next", "standalone");
  const dest = path.join(resourcesDir, "standalone");

  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] 未找到 ${src}，请确认已 next build + bundle:standalone`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // The tree is flat real files (no symlinks), so any recursive copy is safe: mac/linux cp -R, Windows robocopy /e.
  if (process.platform === "win32") {
    execSync(`robocopy "${src}" "${dest}" /e /nfl /ndl /njh /njs >NUL || ver>NUL`, { shell: "cmd.exe" });
  } else {
    execSync(`cp -R "${src}/." "${dest}/"`);
  }

  const ok = fs.existsSync(path.join(dest, "node_modules", "next", "package.json"));
  console.log(`[afterPack] standalone 已拷入 ${dest}（next 模块就位:${ok}）`);
  if (!ok) throw new Error("[afterPack] 拷贝后未见 node_modules/next，打包中止");

  // Guardrail: prove Next's peer deps resolve from the copied `next`. This is exactly what silently failed on
  // Windows in issue #10 (@swc/helpers detached from next after the copy). Fail the build loudly rather than ship
  // a package whose local server crashes on startup. createRequire walks realpaths just like the runtime require.
  try {
    const reqFromNext = createRequire(path.join(dest, "node_modules", "next", "package.json"));
    reqFromNext.resolve("@swc/helpers/_/_interop_require_default");
    reqFromNext.resolve("styled-jsx");
  } catch (e) {
    throw new Error(`[afterPack] standalone 依赖自检失败(next 的 peer dep 不可解析):${e.message}。打包中止，避免再发出启动即崩的包（issue #10）。`);
  }
  console.log("[afterPack] 依赖自检通过：@swc/helpers、styled-jsx 均可从 next 解析 ✓");
};
