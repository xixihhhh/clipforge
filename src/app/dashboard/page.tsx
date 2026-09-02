import Link from "next/link";
import { LuFolderOpen, LuPlus, LuSparkles, LuWalletCards } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";

export default async function DashboardPage() {
  const { user } = await requirePageUser();
  const projects = await projectRepository.getProjects(user.id);
  const firstName = user.displayName?.split(/\s+/)[0] || user.email?.split("@")[0] || "creator";
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm text-muted-foreground">ClipForge workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome back, {firstName}</h1></div>
        <Link href="/dashboard/projects?create=1"><Button><LuPlus className="mr-2 h-4 w-4" />Create New Project</Button></Link>
      </div>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard icon={<LuWalletCards />} label="Current Plan" value="Free" />
        <StatCard icon={<LuSparkles />} label="Credits" value="0" />
        <StatCard icon={<LuFolderOpen />} label="Projects" value={String(projects.length)} />
      </section>
      <Card className="mt-8">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent Projects</CardTitle><Link href="/dashboard/projects" className="text-sm text-primary hover:underline">View all</Link></CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center"><p className="font-medium">No projects yet</p><p className="mt-1 text-sm text-muted-foreground">Create your first ClipForge project to get started.</p></div>
          ) : (
            <div className="divide-y divide-border/60">{projects.slice(0, 5).map((project) => <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="flex items-center justify-between py-4 hover:text-primary"><div><p className="font-medium">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">Updated {project.updatedAt.toLocaleDateString()}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize">{project.status}</span></Link>)}</div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Card><CardContent className="flex items-center gap-4 p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div></CardContent></Card>;
}
