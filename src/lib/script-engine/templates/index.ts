/**
 * 品类模板统一导出
 */

import { beautyTemplates, beautyPromptDirective } from "./beauty";
import { foodTemplates, foodPromptDirective } from "./food";
import { homeTemplates, homePromptDirective } from "./home";
import { fashionTemplates, fashionPromptDirective } from "./fashion";
import { techTemplates, techPromptDirective } from "./tech";

export { beautyTemplates, beautyPromptDirective } from "./beauty";
export { foodTemplates, foodPromptDirective } from "./food";
export { homeTemplates, homePromptDirective } from "./home";
export { fashionTemplates, fashionPromptDirective } from "./fashion";
export { techTemplates, techPromptDirective } from "./tech";

export type { ScriptTemplate } from "./beauty";

/** 品类类型 */
export type ProductCategory = "beauty" | "food" | "home" | "fashion" | "tech";

/** 品类中文名映射 */
export const categoryNameMap: Record<ProductCategory, string> = {
  beauty: "美妆护肤",
  food: "食品零食",
  home: "家居日用",
  fashion: "服饰鞋包",
  tech: "数码3C",
};

/** 品类模板和指令映射表 */
const categoryMap = {
  beauty: { templates: beautyTemplates, directive: beautyPromptDirective },
  food: { templates: foodTemplates, directive: foodPromptDirective },
  home: { templates: homeTemplates, directive: homePromptDirective },
  fashion: { templates: fashionTemplates, directive: fashionPromptDirective },
  tech: { templates: techTemplates, directive: techPromptDirective },
} as const;

/** 根据品类获取对应模板和 prompt 指令（未知品类回退到 beauty，避免崩溃） */
export function getTemplatesByCategory(category: ProductCategory) {
  return categoryMap[category] ?? categoryMap.beauty;
}
