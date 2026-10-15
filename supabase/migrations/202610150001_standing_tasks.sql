-- Weekly tasks share the calendar's family access and version checks.
alter table public.private_calendar_events add column standing_task boolean not null default false;
alter table public.private_calendar_events add constraint standing_task_weekly check (not standing_task or coalesce(recurrence->>'frequency' = 'weekly' and (recurrence->>'interval')::integer = 1, false));

create or replace function public.calendar_save(payload jsonb,event_id uuid default null,expected_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; participants text[]; current_version integer; actor_family uuid; actor_profile uuid;
begin
 actor_family:=public.require_calendar_family();
 select id into actor_profile from public.profiles where auth_user_id=(select auth.uid());
 if jsonb_typeof(payload)<>'object' or jsonb_typeof(payload->'participant_ids')<>'array' then raise exception 'Ogiltig aktivitet.'; end if;
 select array_agg(p) into participants from jsonb_array_elements_text(payload->'participant_ids') p;
 if cardinality(participants)<> (select count(distinct p) from unnest(participants) p) then raise exception 'Dubblerad deltagare.'; end if;
 if event_id is null then
  insert into public.private_calendar_events(family_id,created_by,updated_by,title,description,location,starts_at,ends_at,all_day,participant_ids,category,recurrence,exception_dates,standing_task)
  values(actor_family,actor_profile,actor_profile,trim(payload->>'title'),coalesce(payload->>'description',''),coalesce(payload->>'location',''),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'all_day')::boolean,participants,payload->>'category',nullif(payload->'recurrence','null'::jsonb),payload->'exception_dates',coalesce((payload->>'standing_task')::boolean,false)) returning id into result;
 else
  select version into current_version from public.private_calendar_events where id=event_id and family_id=actor_family and deleted_at is null for update;
  if current_version is null then raise exception 'Aktiviteten finns inte längre.'; end if;
  if expected_version is null or current_version<>expected_version then raise exception 'Aktiviteten har ändrats på en annan enhet. Stäng och öppna den igen.'; end if;
  update public.private_calendar_events set updated_by=actor_profile,title=trim(payload->>'title'),description=coalesce(payload->>'description',''),location=coalesce(payload->>'location',''),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,all_day=(payload->>'all_day')::boolean,participant_ids=participants,category=payload->>'category',recurrence=nullif(payload->'recurrence','null'::jsonb),exception_dates=payload->'exception_dates',standing_task=coalesce((payload->>'standing_task')::boolean,false),version=version+1 where id=event_id and family_id=actor_family returning id into result;
 end if;
 update public.private_calendar_settings set revision=revision+1 where family_id=actor_family;
 return result;
end;$$;
