"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LanguageToggle } from "@/components/language-toggle";
import { TaskCenter } from "@/components/task-center";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* eslint-disable @next/next/no-img-element -- the logo is a small local svg; next/image adds nothing here */

interface NavItem {
  key: string;
  href: string;
  icon: string;
  /** Director-mode-only entrance: hidden in beginner mode so creation stays a single path (工作台) */
  proOnly?: boolean;
}

// Sidebar navigation model: two labeled sections + settings pinned at the bottom.
// `href` doubles as the active-state match target (longest matching prefix wins).
const NAV_SECTIONS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: "navSectionCreate",
    items: [
      { key: "navHome", href: "/start", icon: "home" },
      { key: "navNew", href: "/project/new", icon: "plus", proOnly: true },
      { key: "navClone", href: "/project/clone", icon: "flame" },
      { key: "navMediaLab", href: "/media-lab", icon: "scan", proOnly: true },
      { key: "navBatch", href: "/batch", icon: "layers", proOnly: true },
    ],
  },
  {
    labelKey: "navSectionLibrary",
    items: [
      { key: "navProjects", href: "/projects", icon: "folder" },
      { key: "navProducts", href: "/products", icon: "box" },
      { key: "navPresenters", href: "/presenters", icon: "user" },
    ],
  },
];

// localStorage key for the collapsed-sidebar preference
const NAV_COLLAPSED_KEY = "clipforge_nav_collapsed";

// Minimal inline icon set (16px stroke icons) so the sidebar has zero icon-lib deps
function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
    plus: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    flame: <path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1-.5-2-.5-2s3 1.5 3 5a5.5 5.5 0 0 1-11 0c0-5 5.5-6.5 5.5-11Z" />,
    scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" />,
    layers: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5" />,
    folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
    box: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5L12 12 4 7.5" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    chevron: <path d="m15 6-6 6 6 6" />,
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {paths[name]}
    </svg>
  );
}

/**
 * Global application shell: a persistent desktop sidebar (md+) plus a slim
 * mobile top bar. Mounted once in the root layout so every page shares ONE
 * logo, ONE language toggle and ONE set of module entrances.
 *
 * The sidebar carries two global switches:
 * - UI mode 小白/导演 — beginner mode keeps pages on the happy path, director
 *   mode reveals the pro tooling (director panel, per-shot camera etc.);
 * - collapse — icon-only rail, persisted per device.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT("common");
  const pathname = usePathname();
  const router = useRouter();
  const uiMode = useSettingsStore((s) => s.uiMode);
  const setUiMode = useSettingsStore((s) => s.setUiMode);

  // collapsed preference (loaded post-mount so SSR markup stays stable)
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        if (localStorage.getItem(NAV_COLLAPSED_KEY) === "1") setCollapsed(true);
      } catch { /* storage unavailable → stay expanded */ }
    });
    return () => { cancelled = true; };
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // beginner mode keeps ONE creation entrance (工作台); pro-only entrances stay in director mode
  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => uiMode === "pro" || !i.proOnly),
  })).filter((s) => s.items.length > 0);
  const visibleItems = sections.flatMap((s) => s.items);

  const active = visibleItems.reduce<string | null>((best, item) => {
    if (!pathname?.startsWith(item.href)) return best;
    return best && best.length >= item.href.length ? best : item.href;
  }, null);
  const settingsActive = pathname?.startsWith("/settings") ?? false;
  const isSaasSurface = pathname === "/login" || pathname === "/register" || pathname === "/forgot-password" || pathname === "/reset-password" || pathname?.startsWith("/dashboard");

  const navLink = (item: NavItem) => (
    <Link
      key={item.key}
      href={item.href}
      title={collapsed ? t(item.key) : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? "justify-center px-0" : ""} ${
        active === item.href
          ? "bg-primary/15 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      <NavIcon name={item.icon} />
      {!collapsed && t(item.key)}
    </Link>
  );

  if (isSaasSurface) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/50 bg-background/60 transition-[width] md:flex ${collapsed ? "w-14" : "w-56"}`}>
        <Link href="/start" className={`flex items-center gap-2.5 pb-4 pt-5 ${collapsed ? "justify-center px-0" : "px-4"}`}>
          <img src="/icon.svg" alt="" width={30} height={30} className="rounded-[9px]" />
          {!collapsed && <span className="text-base font-bold tracking-tight">ClipForge</span>}
        </Link>
        <nav className={`flex-1 space-y-5 overflow-y-auto py-2 ${collapsed ? "px-2" : "px-3"}`}>
          {sections.map((section) => (
            <div key={section.labelKey} className="space-y-0.5">
              {!collapsed && (
                <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {t(section.labelKey)}
                </div>
              )}
              {section.items.map(navLink)}
            </div>
          ))}
        </nav>
        <div className={`space-y-1 border-t border-border/50 py-3 ${collapsed ? "px-2" : "px-3"}`}>
          {/* UI mode: beginner ⇄ director (hidden when collapsed — expand to switch) */}
          {!collapsed && (
            <div className="mb-1 flex rounded-lg border border-border/50 p-0.5" title={t("uiModeTip")}>
              {(["simple", "pro"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setUiMode(m)}
                  className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${
                    uiMode === m
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(m === "simple" ? "uiModeSimple" : "uiModePro")}
                </button>
              ))}
            </div>
          )}
          {/* task center: cross-project running/attention feed (the "global" word would make eslint parse this comment as a globals directive) */}
          <div className={collapsed ? "flex justify-center" : ""}>
            <TaskCenter collapsed={collapsed} />
          </div>
          <Link
            href="/settings"
            title={collapsed ? t("settings") : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? "justify-center px-0" : ""} ${
              settingsActive
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <NavIcon name="gear" />
            {!collapsed && t("settings")}
          </Link>
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-1.5"}`}>
            {!collapsed && <LanguageToggle />}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={t(collapsed ? "navExpand" : "navCollapse")}
              title={t(collapsed ? "navExpand" : "navCollapse")}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground ${collapsed ? "rotate-180" : ""}`}
            >
              <NavIcon name="chevron" />
            </button>
          </div>
        </div>
      </aside>

      {/* Content column; mobile gets a slim top bar with a menu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 flex h-12 items-center justify-between border-b border-border/50 bg-background/80 px-4 backdrop-blur-xl md:hidden">
          <Link href="/start" className="flex items-center gap-2">
            <img src="/icon.svg" alt="" width={24} height={24} className="rounded-[7px]" />
            <span className="text-sm font-bold tracking-tight">ClipForge</span>
          </Link>
          <div className="flex items-center gap-1">
            <TaskCenter collapsed />
            <LanguageToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("navMenu")}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </svg>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Base UI menu items don't take asChild — navigate via router */}
                {visibleItems.map((item) => (
                  <DropdownMenuItem key={item.key} onClick={() => router.push(item.href)}>
                    {t(item.key)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  {t("settings")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
