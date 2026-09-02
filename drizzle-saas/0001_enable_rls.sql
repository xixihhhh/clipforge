-- Supabase PostgreSQL RLS hardening for ClipForge SaaS.
--
-- Current ownership model:
--   public.users.auth_user_id = auth.users.id
--   public.projects.user_id   = public.users.id (the project owner)
--
-- This migration is Supabase-specific because it uses auth.uid() and the
-- authenticated/service_role database roles. It is intentionally repeatable:
-- policies are dropped before they are recreated and helper functions use
-- CREATE OR REPLACE.

create schema if not exists private;
--> statement-breakpoint

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users as u
  where u.auth_user_id = (select auth.uid())
  limit 1
$$;
--> statement-breakpoint

create or replace function private.owns_project(candidate_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as p
    where p.id = candidate_project_id
      and p.user_id = private.current_app_user_id()
  )
$$;
--> statement-breakpoint

revoke all on function private.current_app_user_id() from public, anon;
--> statement-breakpoint
revoke all on function private.owns_project(uuid) from public, anon;
--> statement-breakpoint
grant usage on schema private to authenticated, service_role;
--> statement-breakpoint
grant execute on function private.current_app_user_id() to authenticated, service_role;
--> statement-breakpoint
grant execute on function private.owns_project(uuid) to authenticated, service_role;
--> statement-breakpoint

alter table public.users enable row level security;
--> statement-breakpoint
alter table public.users force row level security;
--> statement-breakpoint
alter table public.projects enable row level security;
--> statement-breakpoint
alter table public.projects force row level security;
--> statement-breakpoint

revoke all on table public.users from public, anon;
--> statement-breakpoint
revoke all on table public.projects from public, anon;
--> statement-breakpoint
grant select, insert, update, delete on table public.users to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on table public.projects to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on table public.users to service_role;
--> statement-breakpoint
grant select, insert, update, delete on table public.projects to service_role;
--> statement-breakpoint

-- Drop both the earlier draft names and the final names so reruns are safe.
drop policy if exists users_select_own on public.users;
--> statement-breakpoint
drop policy if exists users_insert_own on public.users;
--> statement-breakpoint
drop policy if exists users_update_own on public.users;
--> statement-breakpoint
drop policy if exists users_delete_own on public.users;
--> statement-breakpoint

create policy users_select_own
on public.users
for select
to authenticated
using (auth_user_id = (select auth.uid()));
--> statement-breakpoint

create policy users_insert_own
on public.users
for insert
to authenticated
with check (auth_user_id = (select auth.uid()));
--> statement-breakpoint

create policy users_update_own
on public.users
for update
to authenticated
using (auth_user_id = (select auth.uid()))
with check (auth_user_id = (select auth.uid()));
--> statement-breakpoint

create policy users_delete_own
on public.users
for delete
to authenticated
using (auth_user_id = (select auth.uid()));
--> statement-breakpoint

drop policy if exists projects_select_own on public.projects;
--> statement-breakpoint
drop policy if exists projects_insert_own on public.projects;
--> statement-breakpoint
drop policy if exists projects_update_own on public.projects;
--> statement-breakpoint
drop policy if exists projects_delete_own on public.projects;
--> statement-breakpoint

create policy projects_select_own
on public.projects
for select
to authenticated
using (user_id = private.current_app_user_id());
--> statement-breakpoint

create policy projects_insert_own
on public.projects
for insert
to authenticated
with check (user_id = private.current_app_user_id());
--> statement-breakpoint

create policy projects_update_own
on public.projects
for update
to authenticated
using (user_id = private.current_app_user_id())
with check (user_id = private.current_app_user_id());
--> statement-breakpoint

create policy projects_delete_own
on public.projects
for delete
to authenticated
using (user_id = private.current_app_user_id());
--> statement-breakpoint

-- Defense for every additional public SaaS table that exists when this
-- migration runs. project_id is checked through the owning project. A direct
-- user_id is an app-user UUID; a direct owner_id is an auth.users UUID. If a
-- table contains more than one ownership column, every condition must match.
do $$
declare
  tenant_table record;
  ownership_check text;
  invalid_column text;
begin
  for tenant_table in
    select
      c.table_name,
      bool_or(c.column_name = 'project_id') as has_project_id,
      bool_or(c.column_name = 'user_id') as has_user_id,
      bool_or(c.column_name = 'owner_id') as has_owner_id
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.column_name in ('project_id', 'user_id', 'owner_id')
      and c.table_name not in ('users', 'projects')
    group by c.table_name
  loop
    select c.column_name
      into invalid_column
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = tenant_table.table_name
      and c.column_name in ('project_id', 'user_id', 'owner_id')
      and c.udt_name <> 'uuid'
    limit 1;

    if invalid_column is not null then
      raise exception 'Tenant column %.% must use uuid before RLS can be enabled', tenant_table.table_name, invalid_column;
    end if;

    ownership_check := '';
    if tenant_table.has_project_id then
      ownership_check := 'private.owns_project(project_id)';
    end if;
    if tenant_table.has_user_id then
      ownership_check := ownership_check
        || case when ownership_check = '' then '' else ' and ' end
        || 'user_id = private.current_app_user_id()';
    end if;
    if tenant_table.has_owner_id then
      ownership_check := ownership_check
        || case when ownership_check = '' then '' else ' and ' end
        || 'owner_id = (select auth.uid())';
    end if;

    execute format('alter table public.%I enable row level security', tenant_table.table_name);
    execute format('alter table public.%I force row level security', tenant_table.table_name);
    execute format('revoke all on table public.%I from public, anon', tenant_table.table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tenant_table.table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tenant_table.table_name);

    execute format('drop policy if exists tenant_select_own on public.%I', tenant_table.table_name);
    execute format('drop policy if exists tenant_insert_own on public.%I', tenant_table.table_name);
    execute format('drop policy if exists tenant_update_own on public.%I', tenant_table.table_name);
    execute format('drop policy if exists tenant_delete_own on public.%I', tenant_table.table_name);

    execute format(
      'create policy tenant_select_own on public.%I for select to authenticated using (%s)',
      tenant_table.table_name,
      ownership_check
    );
    execute format(
      'create policy tenant_insert_own on public.%I for insert to authenticated with check (%s)',
      tenant_table.table_name,
      ownership_check
    );
    execute format(
      'create policy tenant_update_own on public.%I for update to authenticated using (%s) with check (%s)',
      tenant_table.table_name,
      ownership_check,
      ownership_check
    );
    execute format(
      'create policy tenant_delete_own on public.%I for delete to authenticated using (%s)',
      tenant_table.table_name,
      ownership_check
    );
  end loop;
end
$$;
--> statement-breakpoint

-- Fail the deployment rather than silently leaving a tenant table without RLS.
do $$
declare
  unsecured_tables text;
begin
  select string_agg(distinct format('%I.%I', c.table_schema, c.table_name), ', ')
    into unsecured_tables
  from information_schema.columns as c
  join pg_catalog.pg_class as pc on pc.relname = c.table_name
  join pg_catalog.pg_namespace as pn on pn.oid = pc.relnamespace and pn.nspname = c.table_schema
  where c.table_schema = 'public'
    and c.column_name in ('project_id', 'user_id', 'owner_id')
    and not pc.relrowsecurity;

  if unsecured_tables is not null then
    raise exception 'RLS is not enabled for tenant tables: %', unsecured_tables;
  end if;
end
$$;
