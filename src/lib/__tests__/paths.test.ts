import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { getDataDir, getMigrationsDir, getUploadsDir, getOutputDir, fileNameOf } from "@/lib/paths";

const origData = process.env.APP_DATA_DIR;
const origMig = process.env.APP_MIGRATIONS_DIR;

afterEach(() => {
  if (origData === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = origData;
  if (origMig === undefined) delete process.env.APP_MIGRATIONS_DIR;
  else process.env.APP_MIGRATIONS_DIR = origMig;
});

describe("paths 运行时路径解析", () => {
  it("未注入环境变量时回退到 cwd/data（开发态行为不变）", () => {
    delete process.env.APP_DATA_DIR;
    expect(getDataDir()).toBe(join(process.cwd(), "data"));
    expect(getUploadsDir()).toBe(join(process.cwd(), "data", "uploads"));
    expect(getOutputDir()).toBe(join(process.cwd(), "data", "output"));
  });

  it("注入 APP_DATA_DIR 时所有可写路径都迁过去（Electron 打包关键）", () => {
    process.env.APP_DATA_DIR = "/tmp/daihuo-userdata";
    expect(getDataDir()).toBe("/tmp/daihuo-userdata");
    expect(getUploadsDir()).toBe("/tmp/daihuo-userdata/uploads");
    expect(getOutputDir()).toBe("/tmp/daihuo-userdata/output");
  });

  it("迁移目录可单独注入（只读资源与可写数据分离）", () => {
    delete process.env.APP_MIGRATIONS_DIR;
    expect(getMigrationsDir()).toBe(join(process.cwd(), "drizzle"));
    process.env.APP_MIGRATIONS_DIR = "/res/drizzle";
    expect(getMigrationsDir()).toBe("/res/drizzle");
  });
});

// issue #15: Windows-written DB rows carry backslash absolute paths; a plain split("/")
// returned the whole path and produced broken /api/output URLs (404 on playback/download)
describe("fileNameOf", () => {
  it("extracts the file name from a Windows absolute path", () => {
    expect(fileNameOf("D:\\clipforge\\data\\output\\proj-1\\final_123.mp4")).toBe("final_123.mp4");
  });

  it("extracts the file name from POSIX absolute and relative paths", () => {
    expect(fileNameOf("/Users/me/data/output/proj-1/final_123.mp4")).toBe("final_123.mp4");
    expect(fileNameOf("output/proj-1/final_123.mp4")).toBe("final_123.mp4");
  });

  it("handles mixed separators (forward-slash Windows paths)", () => {
    expect(fileNameOf("D:/clipforge\\data/output\\final.mp4")).toBe("final.mp4");
  });

  it("returns a bare file name unchanged", () => {
    expect(fileNameOf("final_123.mp4")).toBe("final_123.mp4");
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(fileNameOf(null)).toBe("");
    expect(fileNameOf(undefined)).toBe("");
    expect(fileNameOf("")).toBe("");
  });
});
