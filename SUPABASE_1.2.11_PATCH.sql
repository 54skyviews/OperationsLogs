-- OperationsLogs Version 1.2.11
-- Run once in Supabase SQL Editor before publishing Version 1.2.11.
--
-- This replaces the shared whole-row Flying Day synchronisation with one
-- independent database row per value.

create table if not exists public.flying_day_values (
  date date not null,
  field_name text not null,
  value text not null default '',
  modified_by_device uuid references public.devices(id),
  modified_at timestamptz not null default now(),
  primary key (date, field_name),
  check (field_name in ('day','runway','windDirection','windSpeed'))
);

alter table public.flying_day_values enable row level security;

drop policy if exists "approved devices read flying day values"
on public.flying_day_values;
create policy "approved devices read flying day values"
on public.flying_day_values
for select to authenticated
using (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices insert flying day values"
on public.flying_day_values;
create policy "approved devices insert flying day values"
on public.flying_day_values
for insert to authenticated
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices update flying day values"
on public.flying_day_values;
create policy "approved devices update flying day values"
on public.flying_day_values
for update to authenticated
using (public.is_approved_device() or public.is_operations_admin())
with check (public.is_approved_device() or public.is_operations_admin());

drop policy if exists "approved devices delete flying day values"
on public.flying_day_values;
create policy "approved devices delete flying day values"
on public.flying_day_values
for delete to authenticated
using (public.is_approved_device() or public.is_operations_admin());

-- Copy current values from the old flying_days table.
insert into public.flying_day_values(date, field_name, value, modified_by_device, modified_at)
select date, 'day', coalesce(day, ''), modified_by_device, modified_at
from public.flying_days
on conflict (date, field_name) do update
set value = excluded.value,
    modified_by_device = excluded.modified_by_device,
    modified_at = excluded.modified_at;

insert into public.flying_day_values(date, field_name, value, modified_by_device, modified_at)
select date, 'runway', coalesce(runway, ''), modified_by_device, modified_at
from public.flying_days
on conflict (date, field_name) do update
set value = excluded.value,
    modified_by_device = excluded.modified_by_device,
    modified_at = excluded.modified_at;

insert into public.flying_day_values(date, field_name, value, modified_by_device, modified_at)
select date, 'windDirection', coalesce(wind_direction, ''), modified_by_device, modified_at
from public.flying_days
on conflict (date, field_name) do update
set value = excluded.value,
    modified_by_device = excluded.modified_by_device,
    modified_at = excluded.modified_at;

insert into public.flying_day_values(date, field_name, value, modified_by_device, modified_at)
select date, 'windSpeed', coalesce(wind_speed, ''), modified_by_device, modified_at
from public.flying_days
on conflict (date, field_name) do update
set value = excluded.value,
    modified_by_device = excluded.modified_by_device,
    modified_at = excluded.modified_at;

-- Add the new table to Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'flying_day_values'
  ) then
    alter publication supabase_realtime
      add table public.flying_day_values;
  end if;
end $$;

-- Audit the new table.
create or replace function public.operationslogs_flying_day_value_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events(
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    auth_user_id,
    device_id
  )
  values (
    'flying_day_values',
    coalesce(new.date, old.date)::text || ':' ||
      coalesce(new.field_name, old.field_name),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    auth.uid(),
    coalesce(new.modified_by_device, old.modified_by_device)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_flying_day_values
on public.flying_day_values;

create trigger audit_flying_day_values
after insert or update or delete
on public.flying_day_values
for each row
execute function public.operationslogs_flying_day_value_audit();
