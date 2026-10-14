begin;
-- Keep single-occurrence replacements attached when the whole series is deleted.
alter table public.private_calendar_events add column series_event_id uuid references public.private_calendar_events(id), add column series_date date;
create unique index calendar_one_active_override on public.private_calendar_events(series_event_id,series_date) where deleted_at is null;
create function private.calendar_delete_overrides() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.deleted_at is not null and old.deleted_at is null then
  update public.private_calendar_events set deleted_at=new.deleted_at,updated_by=new.updated_by,version=version+1
  where series_event_id=new.id and family_id=new.family_id and deleted_at is null;
 end if;
 return new;
end;$$;
revoke all on function private.calendar_delete_overrides() from public,anon,authenticated;
create trigger calendar_delete_overrides after update of deleted_at on public.private_calendar_events for each row execute function private.calendar_delete_overrides();
create or replace function public.calendar_save_occurrence(payload jsonb,event_id uuid,occurrence_date date,expected_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();e public.private_calendar_events%rowtype;seed date;until_date date;freq text;step integer;offset_days integer;result uuid;
begin
 select * into e from public.private_calendar_events where id=event_id and family_id=fam and deleted_at is null for update;
 if not found or expected_version is distinct from e.version then raise exception 'Serien har ändrats. Öppna den igen.';end if;
 if e.recurrence is null or occurrence_date is null then raise exception 'Välj ett återkommande tillfälle.';end if;
 seed:=(e.starts_at at time zone 'Europe/Stockholm')::date;
 until_date:=nullif(e.recurrence->>'until','')::date;
 freq:=e.recurrence->>'frequency';step:=(e.recurrence->>'interval')::integer;
 offset_days:=occurrence_date-seed;
 if offset_days<0 or (until_date is not null and occurrence_date>until_date) or e.exception_dates @> to_jsonb(array[occurrence_date::text]) then raise exception 'Tillfället finns inte.';end if;
 if (freq='daily' and offset_days%step<>0) or (freq='weekly' and offset_days%(7*step)<>0) or
 (freq='monthly' and (extract(day from occurrence_date)<>extract(day from seed) or ((extract(year from occurrence_date)::integer-extract(year from seed)::integer)*12+extract(month from occurrence_date)::integer-extract(month from seed)::integer)%step<>0)) then raise exception 'Tillfället finns inte i serien.';end if;
 perform public.calendar_save(to_jsonb(e)||jsonb_build_object('exception_dates',e.exception_dates||to_jsonb(occurrence_date::text)),e.id,e.version);
 result:=public.calendar_save(payload||jsonb_build_object('recurrence',null,'exception_dates','[]'::jsonb),null,null);
 update public.private_calendar_events set series_event_id=e.id,series_date=occurrence_date where id=result;
 return result;
end;$$;
notify pgrst,'reload schema';
commit;
