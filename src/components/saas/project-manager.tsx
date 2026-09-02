"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LuFolderOpen, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SaasProject } from "@/lib/saas-db/schema";

export function ProjectManager({ initialProjects }: { initialProjects: SaasProject[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState(initialProjects);
  const [creating, setCreating] = useState(() => searchParams.get("create") === "1");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function createProject() {
    if (!name.trim()) return;
    const response = await fetch("/api/project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error ?? "Unable to create project.");
    setProjects((current) => [result, ...current]);
    setName(""); setCreating(false); setError(null);
    router.replace("/dashboard/projects");
  }

  async function renameProject(project: SaasProject) {
    const nextName = window.prompt("Project name", project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    const response = await fetch(`/api/project/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nextName }) });
    if (!response.ok) return setError("Unable to rename project.");
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name: nextName, updatedAt: new Date() } : item));
  }

  async function deleteProject(project: SaasProject) {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    const response = await fetch(`/api/project/${project.id}`, { method: "DELETE" });
    if (!response.ok) return setError("Unable to delete project.");
    setProjects((current) => current.filter((item) => item.id !== project.id));
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Workspace</p><h1 className="mt-1 text-3xl font-bold">Projects</h1></div><Button onClick={() => setCreating(true)}><LuPlus className="mr-2 h-4 w-4" />Create Project</Button></div>
      {creating && <Card className="mt-6"><CardContent className="flex flex-col gap-3 p-5 sm:flex-row"><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} placeholder="Project name" autoFocus /><Button onClick={createProject}>Create</Button><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button></CardContent></Card>}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {projects.length === 0 ? <Card className="mt-6"><CardContent className="flex flex-col items-center py-16 text-center"><LuFolderOpen className="h-9 w-9 text-muted-foreground" /><p className="mt-4 font-medium">Your project library is empty</p><p className="mt-1 text-sm text-muted-foreground">Each project is private to your account.</p></CardContent></Card> :
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <Card key={project.id} className="group"><CardContent className="p-5"><Link href={`/dashboard/projects/${project.id}`} className="block"><div className="flex items-center justify-between"><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs capitalize text-primary">{project.status}</span><span className="text-xs text-muted-foreground">{new Date(project.updatedAt).toLocaleDateString()}</span></div><h2 className="mt-5 truncate text-lg font-semibold">{project.name}</h2><p className="mt-2 line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || "No description"}</p></Link><div className="mt-5 flex gap-2 border-t pt-4"><Button variant="outline" size="sm" onClick={() => renameProject(project)}><LuPencil className="mr-1.5 h-3.5 w-3.5" />Rename</Button><Button variant="outline" size="sm" onClick={() => deleteProject(project)}><LuTrash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button></div></CardContent></Card>)}</div>}
    </>
  );
}
