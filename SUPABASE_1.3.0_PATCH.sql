-- OperationsLogs Version 1.3.0
delete from public.flying_day_values
where field_name not in ('day','runway','windDirection','windSpeed');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='flying_day_values'
  ) then
    alter publication supabase_realtime add table public.flying_day_values;
  end if;
end $$;
