-- Deliberate PUBLIC calendar, explicitly requested 2026-10-13.
-- Isolated from ALL Phase 0 private tables. Enable only after accepting public editing.
begin;
create table public.open_calendar_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 revision bigint not null default 1
);
insert into public.open_calendar_settings(id,enabled) values(true,false);
create table public.open_calendar_people (
 id text primary key check(id in ('tobias','neo','sally')), display_name text not null,
 color text not null check(color in ('blue','green','orange'))
);
insert into public.open_calendar_people values ('tobias','Tobias','blue'),('neo','Neo','green'),('sally','Sally','orange');
create function public.open_calendar_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.open_calendar_settings where id),false);
$$;
create function public.valid_calendar_date(value text) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return value ~ '^\d{4}-\d{2}-\d{2}$' and to_char(value::date,'YYYY-MM-DD')=value;
exception when others then return false;
end;$$;
create function public.valid_calendar_dates(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value)<>'array' then return false; end if;
 return not exists(select 1 from jsonb_array_elements_text(value) d where not public.valid_calendar_date(d));
end;$$;
create function public.valid_calendar_recurrence(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if value is null or value='null'::jsonb then return true; end if;
 return coalesce(jsonb_typeof(value)='object' and value->>'frequency' in ('daily','weekly','monthly')
 and (value->>'interval')::integer between 1 and 52
 and ((value->>'until') is null or public.valid_calendar_date(value->>'until')),false);
exception when others then return false;
end;$$;
create table public.open_calendar_events (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=10000), location text not null default '' check(length(location)<=500),
 starts_at timestamptz not null check(isfinite(starts_at)), ends_at timestamptz not null check(isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '366 days'),
 all_day boolean not null default false, participant_ids text[] not null check(cardinality(participant_ids) between 1 and 3 and participant_ids <@ array['tobias','neo','sally']::text[]),
 category text not null default 'family' check(category in ('family','school')),
 recurrence jsonb check(public.valid_calendar_recurrence(recurrence)),
 exception_dates jsonb not null default '[]' check(public.valid_calendar_dates(exception_dates)),
 version integer not null default 1, deleted_at timestamptz,
 check(not all_day or ((starts_at at time zone 'Europe/Stockholm')::time='00:00' and (ends_at at time zone 'Europe/Stockholm')::time='00:00')),
 check(recurrence->>'until' is null or (recurrence->>'until')::date >= (starts_at at time zone 'Europe/Stockholm')::date)
);
create index on public.open_calendar_events(starts_at);
create table public.open_school_lessons (
 id uuid primary key default gen_random_uuid(), student_id text not null references public.open_calendar_people(id),
 external_id text not null check(length(trim(external_id)) between 1 and 200),
 weekday integer not null check(weekday between 1 and 7), starts_at time not null, ends_at time not null check(ends_at>starts_at),
 subject text not null check(length(trim(subject)) between 1 and 200), room text check(length(room)<=200),
 term_start date not null, term_end date check(term_end>=term_start), exception_dates jsonb not null default '[]' check(public.valid_calendar_dates(exception_dates)),
 unique(student_id,external_id)
);
-- No public write privileges on tables. Public writes use bounded, transactional RPCs only.
alter table public.open_calendar_settings enable row level security;
alter table public.open_calendar_people enable row level security;
alter table public.open_calendar_events enable row level security;
alter table public.open_school_lessons enable row level security;
revoke all on public.open_calendar_settings,public.open_calendar_people,public.open_calendar_events,public.open_school_lessons from public,anon,authenticated;
grant select on public.open_calendar_people,public.open_calendar_events,public.open_school_lessons to anon,authenticated;
create policy public_calendar_read on public.open_calendar_people for select to anon,authenticated using(public.open_calendar_enabled());
create policy public_calendar_read on public.open_calendar_events for select to anon,authenticated using(public.open_calendar_enabled());
create policy public_calendar_read on public.open_school_lessons for select to anon,authenticated using(public.open_calendar_enabled());
-- Snapshot uses invoker/RLS. Public RPC throws when project owner has not enabled it.
create function public.public_calendar_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not public.open_calendar_enabled() then raise exception 'Den offentliga kalendern är inte aktiverad av administratören.'; end if;
 return jsonb_build_object(
 'people',(select coalesce(jsonb_agg(p order by p.id),'[]') from public.open_calendar_people p),
 'activities',(select coalesce(jsonb_agg(e),'[]') from public.open_calendar_events e where deleted_at is null),
 'lessons',(select coalesce(jsonb_agg(l),'[]') from public.open_school_lessons l));
end;$$;
create function public.public_calendar_save(payload jsonb,event_id uuid default null,expected_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; participants text[]; current_version integer;
begin
 if not public.open_calendar_enabled() then raise exception 'Kalendern är inte aktiverad.'; end if;
 if jsonb_typeof(payload)<>'object' or jsonb_typeof(payload->'participant_ids')<>'array' then raise exception 'Ogiltig aktivitet.'; end if;
 select array_agg(p) into participants from jsonb_array_elements_text(payload->'participant_ids') p;
 if cardinality(participants)<> (select count(distinct p) from unnest(participants) p) then raise exception 'Dubblerad deltagare.'; end if;
 if event_id is null then
  insert into public.open_calendar_events(title,description,location,starts_at,ends_at,all_day,participant_ids,category,recurrence,exception_dates)
  values(trim(payload->>'title'),coalesce(payload->>'description',''),coalesce(payload->>'location',''),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'all_day')::boolean,participants,payload->>'category',nullif(payload->'recurrence','null'::jsonb),payload->'exception_dates') returning id into result;
 else
  select version into current_version from public.open_calendar_events where id=event_id and deleted_at is null for update;
  if current_version is null then raise exception 'Aktiviteten finns inte längre.'; end if;
  if expected_version is null or current_version<>expected_version then raise exception 'Aktiviteten har ändrats på en annan enhet. Stäng och öppna den igen.'; end if;
  update public.open_calendar_events set title=trim(payload->>'title'),description=coalesce(payload->>'description',''),location=coalesce(payload->>'location',''),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,all_day=(payload->>'all_day')::boolean,participant_ids=participants,category=payload->>'category',recurrence=nullif(payload->'recurrence','null'::jsonb),exception_dates=payload->'exception_dates',version=version+1 where id=event_id returning id into result;
 end if;
 update public.open_calendar_settings set revision=revision+1 where id;
 return result;
end;$$;
create function public.public_calendar_delete(event_id uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.open_calendar_enabled() then raise exception 'Kalendern är inte aktiverad.'; end if;
 update public.open_calendar_events set deleted_at=now(),version=version+1 where id=event_id and version=expected_version and deleted_at is null;
 if not found then raise exception 'Aktiviteten har ändrats eller raderats. Uppdatera kalendern.'; end if;
 update public.open_calendar_settings set revision=revision+1 where id;
end;$$;
create function public.public_calendar_import(lessons jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare row jsonb; count_rows integer:=0;
begin
 if not public.open_calendar_enabled() then raise exception 'Kalendern är inte aktiverad.'; end if;
 if jsonb_typeof(lessons)<>'array' or jsonb_array_length(lessons) not between 1 and 1000 then raise exception 'Importen ska innehålla 1–1000 lektioner.'; end if;
 if exists(select 1 from jsonb_array_elements(lessons) l group by l->>'student_id',l->>'external_id' having count(*)>1) then raise exception 'Dubblerade lektions-ID:n.'; end if;
 for row in select * from jsonb_array_elements(lessons) loop
  if not public.valid_calendar_date(row->>'term_start') or ((row->>'term_end') is not null and not public.valid_calendar_date(row->>'term_end')) then raise exception 'Ogiltig terminsperiod.'; end if;
  if not (row->>'starts_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or not (row->>'ends_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Start och slut krävs i HH:mm.'; end if;
  insert into public.open_school_lessons(student_id,external_id,weekday,starts_at,ends_at,subject,room,term_start,term_end,exception_dates)
  values(row->>'student_id',row->>'external_id',(row->>'weekday')::integer,(row->>'starts_at')::time,(row->>'ends_at')::time,row->>'subject',row->>'room',(row->>'term_start')::date,(row->>'term_end')::date,row->'exception_dates')
  on conflict(student_id,external_id) do update set weekday=excluded.weekday,starts_at=excluded.starts_at,ends_at=excluded.ends_at,subject=excluded.subject,room=excluded.room,term_start=excluded.term_start,term_end=excluded.term_end,exception_dates=excluded.exception_dates;
  count_rows:=count_rows+1;
 end loop;
 update public.open_calendar_settings set revision=revision+1 where id;
 return count_rows;
end;$$;
-- Exceptions to school's weekly recurrence can be changed through validated upsert.
-- Bulk deletion / replacing a whole source is intentionally a separate admin operation.
revoke all on function public.open_calendar_enabled(),public.valid_calendar_date(text),public.valid_calendar_dates(jsonb),public.valid_calendar_recurrence(jsonb),public.public_calendar_snapshot(),public.public_calendar_save(jsonb,uuid,integer),public.public_calendar_delete(uuid,integer),public.public_calendar_import(jsonb) from public,anon,authenticated;
grant execute on function public.open_calendar_enabled(),public.public_calendar_snapshot(),public.public_calendar_save(jsonb,uuid,integer),public.public_calendar_delete(uuid,integer),public.public_calendar_import(jsonb) to anon,authenticated;
-- RLS needs read access to the non-sensitive revision signal for reconnect/full refresh.
grant select on public.open_calendar_settings to anon,authenticated;
create policy public_calendar_revision on public.open_calendar_settings for select to anon,authenticated using(public.open_calendar_enabled());
-- The standard Supabase publication exists in hosted projects. Local PostgreSQL tests may omit it.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.open_calendar_events,public.open_school_lessons,public.open_calendar_people,public.open_calendar_settings;
 end if;
end $$;
commit;
