import Link from "next/link";
import { requirePageUser } from "@/lib/saas/authorization";
import { LogoutButton } from "@/components/saas/logout-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageUser();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70 bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-7">
            <Link href="/dashboard" className="flex items-center gap-2 font-bold">
              <span className="grid h-8 w-8 place-items-center rounded-lg brand-gradient text-white">C</span>
              ClipForge
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">Overview</Link>
              <Link href="/dashboard/projects" className="hover:text-foreground">Projects</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:block">{user.displayName || user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
