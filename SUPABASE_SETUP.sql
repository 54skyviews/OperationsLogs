-- OperationsLogs Version 1.2
-- Run this entire file once in Supabase: SQL Editor -> New query -> Run.
-- Then create an administrator in Authentication -> Users and add the user's UUID
-- to public.admin_users using the final INSERT example at the end.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  approved boolean not null default false,
  active boolean not null default true,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flying_days (
  date date primary key,
  day text not null default '',
  runway text not null default '',
  wind_direction text not null default '',
  wind_speed text not null default '',
  modified_by_device uuid references public.devices(id),
  modified_at timestamptz not null default now()
);

create table if not exists public.flights (
  id text primary key,
  date date not null,
  type text not null check (type in ('winch','aerotow')),
  status text not null default 'airborne'
    check (status in ('airborne','completed','landing_unknown','cancelled')),
  tug_reg text not null default '',
  tug_pilot text not null default '',
  tow_height text not null default '',
  glider text not null default '',
  p1 text not null default '',
  p2 text not null default '',
  payee text not null default '',
  takeoff text not null default '',
  landing text not null default '',
  duration integer,
  takeoff_at timestamptz,
  landed_at timestamptz,
  remarks text not null default '',
  aeros text not null default '',
  office_use text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  created_by_device uuid references public.devices(id),
  modified_by_device uuid references public.devices(id),
  created_at timestamptz not null default now(),
  modified_at timestamptz not null default now()
);

create index if not exists flights_date_idx on public.flights(date);
create index if not exists flights_status_idx on public.flights(status);
create index if not exists flights_takeoff_idx on public.flights(date, takeoff);

create table if not exists public.master_lists (
  list_key text not null,
  value text not null,
  active boolean not null default true,
  modified_by uuid references auth.users(id),
  modified_at timestamptz not null default now(),
  primary key (list_key, value),
  check (list_key in ('names','gliders','tugAircraft','tugPilots','payees'))
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  auth_user_id uuid,
  device_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.is_operations_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.is_approved_device()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.devices
    where auth_user_id = auth.uid()
      and approved = true
      and active = true
  );
$$;

grant execute on function public.is_operations_admin() to authenticated;
grant execute on function public.is_approved_device() to authenticated;

alter table public.admin_users enable row level security;
alter table public.devices enable row level security;
alter table public.flying_days enable row level security;
alter table public.flights enable row level security;
alter table public.master_lists enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "admins read admin users" on public.admin_users;
create policy "admins read admin users"
on public.admin_users for select to authenticated
using (public.is_operations_admin());

drop policy if exists "device registers itself" on public.devices;
create policy "device registers itself"
on public.devices for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "device reads itself" on public.devices;
create policy "device reads itself"
on public.devices for select to authenticated
using (auth_user_id = auth.uid() or public.is_operations_admin());

drop policy if exists "device updates its name" on public.devices;
create policy "device updates its name"
on public.devices for update to authenticated
using (auth_user_id = auth.uid() or public.is_operations_admin())
with check (auth_user_id = auth.uid() or public.is_operations_admin());

drop policy if exists "admins manage devices" on public.devices;
create policy "admins manage devices"
on public.devices for all to authenticated
using (public.is_operations_admin())
with check (public.is_operations_admin());

drop policy if exists "approved devices read days" on public.flying_days;
create policy "approved devices read days"
on public.flying_days for select to authenticated
using (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices insert days" on public.flying_days;
create policy "approved devices insert days"
on public.flying_days for insert to authenticated
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices update days" on public.flying_days;
create policy "approved devices update days"
on public.flying_days for update to authenticated
using (public.is_approved_device() or public.is_operations_admin())
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices read flights" on public.flights;
create policy "approved devices read flights"
on public.flights for select to authenticated
using (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices insert flights" on public.flights;
create policy "approved devices insert flights"
on public.flights for insert to authenticated
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices update flights" on public.flights;
create policy "approved devices update flights"
on public.flights for update to authenticated
using (public.is_approved_device() or public.is_operations_admin())
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices delete flights" on public.flights;
create policy "approved devices delete flights"
on public.flights for delete to authenticated
using (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices read lists" on public.master_lists;
create policy "approved devices read lists"
on public.master_lists for select to authenticated
using (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "admins insert lists" on public.master_lists;
create policy "admins insert lists"
on public.master_lists for insert to authenticated
with check (public.is_operations_admin());

drop policy if exists "admins update lists" on public.master_lists;
create policy "admins update lists"
on public.master_lists for update to authenticated
using (public.is_operations_admin())
with check (public.is_operations_admin());

drop policy if exists "admins delete lists" on public.master_lists;
create policy "admins delete lists"
on public.master_lists for delete to authenticated
using (public.is_operations_admin());

drop policy if exists "admins read audit" on public.audit_events;
create policy "admins read audit"
on public.audit_events for select to authenticated
using (public.is_operations_admin());

drop policy if exists "approved devices insert audit" on public.audit_events;
create policy "approved devices insert audit"
on public.audit_events for insert to authenticated
with check (public.is_approved_device() or public.is_operations_admin());

create or replace function public.operationslogs_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  record_identifier text;
  device_identifier uuid;
begin
  record_identifier :=
    case
      when tg_table_name = 'flights' then coalesce(new.id, old.id)
      when tg_table_name = 'flying_days' then coalesce(new.date, old.date)::text
      when tg_table_name = 'master_lists' then
        coalesce(new.list_key || ':' || new.value, old.list_key || ':' || old.value)
      else ''
    end;

  device_identifier :=
    case
      when tg_table_name = 'flights' then coalesce(new.modified_by_device, old.modified_by_device)
      when tg_table_name = 'flying_days' then coalesce(new.modified_by_device, old.modified_by_device)
      else null
    end;

  insert into public.audit_events(
    table_name, record_id, action, old_values, new_values,
    auth_user_id, device_id
  )
  values (
    tg_table_name,
    record_identifier,
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    auth.uid(),
    device_identifier
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_flights on public.flights;
create trigger audit_flights
after insert or update or delete on public.flights
for each row execute function public.operationslogs_audit_trigger();

drop trigger if exists audit_flying_days on public.flying_days;
create trigger audit_flying_days
after insert or update or delete on public.flying_days
for each row execute function public.operationslogs_audit_trigger();

drop trigger if exists audit_master_lists on public.master_lists;
create trigger audit_master_lists
after insert or update or delete on public.master_lists
for each row execute function public.operationslogs_audit_trigger();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'flights'
  ) then
    alter publication supabase_realtime add table public.flights;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'flying_days'
  ) then
    alter publication supabase_realtime add table public.flying_days;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'master_lists'
  ) then
    alter publication supabase_realtime add table public.master_lists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'devices'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;
end $$;

-- IMPORTANT:
-- 1. In Supabase Dashboard, enable Authentication -> Providers -> Anonymous Sign-Ins.
-- 2. Create your administrator in Authentication -> Users.
-- 3. Copy that user's UUID and run this separately, replacing the example UUID:
--
-- insert into public.admin_users(user_id)
-- values ('00000000-0000-0000-0000-000000000000');
