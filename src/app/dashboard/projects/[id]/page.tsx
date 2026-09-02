import Link from "next/link";
import { notFound } from "next/navigation";
import { LuArrowLeft, LuExternalLink } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";

export default async function DashboardProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageUser();
  const { id } = await params;
  const project = await projectRepository.getProject(id, user.id);
  if (!project) notFound();
  return <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6"><Link href="/dashboard/projects" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><LuArrowLeft className="mr-2 h-4 w-4" />Back to projects</Link><div className="mt-6 flex flex-wrap items-end justify-between gap-4"><div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs capitalize text-primary">{project.status}</span><h1 className="mt-3 text-3xl font-bold">{project.name}</h1><p className="mt-2 text-muted-foreground">{project.description || "No description added."}</p></div><Link href={`/project/${project.id}/script`}><Button><LuExternalLink className="mr-2 h-4 w-4" />Open ClipForge Workspace</Button></Link></div><Card className="mt-8"><CardHeader><CardTitle>Project details</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><Detail label="Project ID" value={project.id} /><Detail label="Owner" value={user.email || user.id} /><Detail label="Created" value={project.createdAt.toLocaleString()} /><Detail label="Last updated" value={project.updatedAt.toLocaleString()} /></CardContent></Card></main>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-all text-sm">{value}</p></div>; }
