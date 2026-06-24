import type { Locale } from "../config";
import { common } from "./common";
import { home } from "./home";
import { start } from "./start";
import { topic } from "./topic";
import { newProject } from "./newProject";
import { clone } from "./clone";
import { batch } from "./batch";
import { products } from "./products";
import { settings } from "./settings";
import { generationSettings } from "./generationSettings";
import { showcase } from "./showcase";
import { script } from "./script";
import { assets } from "./assets";
import { video } from "./video";
import { exportPage } from "./exportPage";

// 所有命名空间集中注册（新增页面时在此追加一行）
const namespaces = {
  common,
  home,
  start,
  topic,
  newProject,
  clone,
  batch,
  products,
  settings,
  generationSettings,
  showcase,
  script,
  assets,
  video,
  exportPage,
};

/** messages[locale][namespace][key] = 翻译文本 */
export const messages: Record<Locale, Record<string, Record<string, string>>> = {
  zh: Object.fromEntries(Object.entries(namespaces).map(([ns, m]) => [ns, m.zh])),
  en: Object.fromEntries(Object.entries(namespaces).map(([ns, m]) => [ns, m.en])),
};
