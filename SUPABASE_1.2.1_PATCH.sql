-- OperationsLogs Version 1.2.1 patch
-- Run once in Supabase SQL Editor. Safe to run if devices is already enabled for Realtime.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'devices'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;
end $$;
