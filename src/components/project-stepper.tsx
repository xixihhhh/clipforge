"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";

// Pipeline steps in order; `path` is the route suffix under /project/[id]/
const STEPS = [
  { key: "stepScript", path: "script" },
  { key: "stepAssets", path: "assets" },
  { key: "stepVideo", path: "video" },
  { key: "stepExport", path: "export" },
] as const;

/**
 * Clickable four-step progress pills shared by the project pipeline pages
 * (script / assets / export). Visually identical to the legacy inline
 * stepper, but every pill is a real link so users can jump between steps:
 * the current step is highlighted, completed steps show a check mark, and
 * future steps are muted — all remain navigable.
 *
 * The current step is derived from the pathname suffix (no props needed);
 * the project id comes from useParams.
 *
 * NOTE: video/page.tsx still renders its own legacy inline (non-clickable)
 * stepper because that file is owned by a parallel session (avoidance).
 * Once the avoidance is lifted, replace its inline stepper with this
 * component as well.
 */
export function ProjectStepper() {
  const t = useT("common");
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  // Current step index from the route suffix; clamp to 0 if no suffix matches
  const current = Math.max(
    0,
    STEPS.findIndex((s) => pathname?.endsWith(`/${s.path}`))
  );

  return (
    <>
      {/* mobile: full step pills don't fit, show a compact "current step / total" badge instead */}
      <div className="sm:hidden flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
          {current + 1}
        </span>
        {t(STEPS[current].key)}
        <span className="text-primary-foreground/60">{current + 1}/{STEPS.length}</span>
      </div>
      {/* desktop: full pills; every step links to its page for free navigation */}
      <div className="hidden sm:flex items-center gap-1">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <Link
              href={`/project/${id}/${step.path}`}
              className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                i === current
                  ? "bg-primary text-primary-foreground"
                  : i < current
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  i === current ? "bg-white/20" : i < current ? "bg-primary/20" : "bg-muted"
                }`}
              >
                {i < current ? "✓" : i + 1}
              </span>
              {t(step.key)}
            </Link>
            {i < STEPS.length - 1 && <div className="mx-1 h-px w-4 bg-border" />}
          </div>
        ))}
      </div>
    </>
  );
}
