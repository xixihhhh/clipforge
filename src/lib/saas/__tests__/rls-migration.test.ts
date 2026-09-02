import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "drizzle-saas", "0001_enable_rls.sql");
const migration = readFileSync(migrationPath, "utf8").toLowerCase();

describe("Supabase RLS migration", () => {
  it.each(["users", "projects"])("enables and forces RLS on %s", (table) => {
    expect(migration).toContain(`alter table public.${table} enable row level security`);
    expect(migration).toContain(`alter table public.${table} force row level security`);
  });

  it.each(["select", "insert", "update", "delete"])("defines users %s-own policy", (operation) => {
    expect(migration).toContain(`create policy users_${operation}_own`);
  });

  it.each(["select", "insert", "update", "delete"])("defines projects %s-own policy", (operation) => {
    expect(migration).toContain(`create policy projects_${operation}_own`);
  });

  it("binds project ownership to the current Supabase identity", () => {
    expect(migration).toContain("p.user_id = private.current_app_user_id()");
    expect(migration).toContain("where u.auth_user_id = (select auth.uid())");
  });

  it("covers future project_id, user_id, and owner_id tenant tables", () => {
    expect(migration).toContain("c.column_name in ('project_id', 'user_id', 'owner_id')");
    expect(migration).toContain("private.owns_project(project_id)");
    expect(migration).toContain("user_id = private.current_app_user_id()");
    expect(migration).toContain("owner_id = (select auth.uid())");
  });

  it("revokes anonymous access and grants only CRUD to authenticated users", () => {
    expect(migration).toContain("revoke all on table public.users from public, anon");
    expect(migration).toContain("revoke all on table public.projects from public, anon");
    expect(migration).toContain("grant select, insert, update, delete on table public.users to authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.projects to authenticated");
  });

  it("is repeatable without duplicate-policy errors", () => {
    expect(migration).toContain("create or replace function private.current_app_user_id()");
    expect(migration).toContain("drop policy if exists users_select_own");
    expect(migration).toContain("drop policy if exists projects_select_own");
    expect(migration).toContain("drop policy if exists tenant_select_own");
  });

  it("keeps service-role access explicit and server-trusted", () => {
    expect(migration).toContain("to service_role");
    const adminModule = readFileSync(join(process.cwd(), "src", "lib", "supabase", "admin.ts"), "utf8");
    expect(adminModule).toMatch(/^import "server-only";/);
    expect(adminModule).not.toMatch(/["']use client["']/);
  });
});
