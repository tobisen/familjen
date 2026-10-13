-- Phase 1.5: revoke public access, bind identities on server, scope every calendar row.
-- Upgrade is atomic. Back up first. A legacy public calendar needs one explicit family owner.
begin;
revoke all on function public.public_calendar_snapshot(),public.public_calendar_save(jsonb,uuid,integer),public.public_calendar_delete(uuid,integer),public.public_calendar_import(jsonb),public.open_calendar_enabled() from public,anon,authenticated;
drop function public.public_calendar_snapshot();
drop function public.public_calendar_save(jsonb,uuid,integer);
drop function public.public_calendar_delete(uuid,integer);
drop function public.public_calendar_import(jsonb);
drop policy public_calendar_read on public.open_calendar_people;
drop policy public_calendar_read on public.open_calendar_events;
drop policy public_calendar_read on public.open_school_lessons;
drop policy public_calendar_revision on public.open_calendar_settings;
drop function public.open_calendar_enabled();
alter table public.profiles add column profile_key text check(profile_key in ('tobias','neo','sally'));
create unique index profiles_family_key on public.profiles(family_id,profile_key);
update public.profiles set profile_key=lower(display_name) where lower(display_name) in ('tobias','neo','sally');
-- Single legacy calendar cannot safely be guessed into one of multiple families.
do $$ begin
 if (select count(*) from public.families)>1 then raise exception 'Flera familjer finns. Ange explicit ägare till den gamla kalendern före migrering.'; end if;
 if not exists(select 1 from public.families) then insert into public.families(name) values('Familjen'); end if;
end $$;
insert into public.profiles(family_id,display_name,profile_key)
 select f.id,p.display_name,p.id from public.families f cross join public.open_calendar_people p
 on conflict(family_id,profile_key) do nothing;
alter table public.open_calendar_events rename to private_calendar_events;
alter table public.open_school_lessons rename to private_school_lessons;
alter table public.open_calendar_people rename to private_calendar_people;
alter table public.open_calendar_settings rename to private_calendar_settings;
alter table public.private_calendar_events add column family_id uuid references public.families(id);
alter table public.private_school_lessons add column family_id uuid references public.families(id);
alter table public.private_calendar_people add column family_id uuid references public.families(id);
alter table public.private_calendar_settings add column family_id uuid references public.families(id);
update public.private_calendar_events set family_id=(select id from public.families);
update public.private_school_lessons set family_id=(select id from public.families);
update public.private_calendar_people set family_id=(select id from public.families);
update public.private_calendar_settings set family_id=(select id from public.families);
alter table public.private_calendar_events alter column family_id set not null;
alter table public.private_school_lessons alter column family_id set not null;
alter table public.private_calendar_people alter column family_id set not null;
alter table public.private_calendar_settings alter column family_id set not null;
alter table public.private_school_lessons drop constraint open_school_lessons_student_id_fkey;
alter table public.private_calendar_people drop constraint open_calendar_people_pkey;
alter table public.private_calendar_people add primary key(family_id,id);
alter table public.private_school_lessons add foreign key(family_id,student_id) references public.private_calendar_people(family_id,id);
alter table public.private_school_lessons drop constraint open_school_lessons_student_id_external_id_key;
alter table public.private_school_lessons add unique(family_id,student_id,external_id);
alter table public.private_school_lessons add column term_confirmed boolean not null default false;
-- Legacy unconfirmed terms remain private but are not rendered until confirmed via import.
alter table public.private_calendar_settings drop column id;
alter table public.private_calendar_settings drop column enabled;
alter table public.private_calendar_settings add primary key(family_id);
alter table public.private_calendar_events add column created_by uuid;
alter table public.private_calendar_events add column updated_by uuid;
alter table public.private_calendar_events add foreign key(created_by,family_id) references public.profiles(id,family_id);
alter table public.private_calendar_events add foreign key(updated_by,family_id) references public.profiles(id,family_id);
create index on public.private_calendar_events(family_id);
create index on public.private_school_lessons(family_id);
create function public.calendar_family_id() returns uuid language sql stable security definer set search_path='' as $$
 select family_id from public.profiles where auth_user_id=(select auth.uid()) and profile_key is not null;
$$;
create function public.calendar_identity() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile_id',id,'profile_key',profile_key,'display_name',display_name,'family_id',family_id)
 from public.profiles where auth_user_id=(select auth.uid()) and profile_key is not null;
$$;
create function public.require_calendar_family() returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 result:=public.calendar_family_id();
 if result is null then raise exception 'Registrerad familjeidentitet krävs.' using errcode='42501'; end if;
 return result;
end;$$;
revoke all on public.private_calendar_people from public,anon,authenticated;
grant select on public.private_calendar_people to authenticated;
create policy family_read on public.private_calendar_people for select to authenticated using(family_id=(select public.calendar_family_id()));
revoke all on public.private_calendar_events from public,anon,authenticated;
grant select on public.private_calendar_events to authenticated;
create policy family_read on public.private_calendar_events for select to authenticated using(family_id=(select public.calendar_family_id()));
revoke all on public.private_school_lessons from public,anon,authenticated;
grant select on public.private_school_lessons to authenticated;
create policy family_read on public.private_school_lessons for select to authenticated using(family_id=(select public.calendar_family_id()));
revoke all on public.private_calendar_settings from public,anon,authenticated;
grant select on public.private_calendar_settings to authenticated;
create policy family_read on public.private_calendar_settings for select to authenticated using(family_id=(select public.calendar_family_id()));
-- Table writes are RPC-only, including for authenticated users.
create function public.calendar_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_family uuid;
begin
 actor_family:=public.require_calendar_family();
 return jsonb_build_object(
 'people',(select coalesce(jsonb_agg(p order by p.id),'[]') from public.private_calendar_people p where family_id=actor_family),
 'activities',(select coalesce(jsonb_agg(e),'[]') from public.private_calendar_events e where family_id=actor_family and deleted_at is null),
 'lessons',(select coalesce(jsonb_agg(l),'[]') from public.private_school_lessons l where family_id=actor_family and term_confirmed));
end;$$;
create function public.calendar_save(payload jsonb,event_id uuid default null,expected_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; participants text[]; current_version integer; actor_family uuid; actor_profile uuid;
begin
 actor_family:=public.require_calendar_family();
 select id into actor_profile from public.profiles where auth_user_id=(select auth.uid());
 if jsonb_typeof(payload)<>'object' or jsonb_typeof(payload->'participant_ids')<>'array' then raise exception 'Ogiltig aktivitet.'; end if;
 select array_agg(p) into participants from jsonb_array_elements_text(payload->'participant_ids') p;
 if cardinality(participants)<> (select count(distinct p) from unnest(participants) p) then raise exception 'Dubblerad deltagare.'; end if;
 if event_id is null then
  insert into public.private_calendar_events(family_id,created_by,updated_by,title,description,location,starts_at,ends_at,all_day,participant_ids,category,recurrence,exception_dates)
  values(actor_family,actor_profile,actor_profile,trim(payload->>'title'),coalesce(payload->>'description',''),coalesce(payload->>'location',''),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'all_day')::boolean,participants,payload->>'category',nullif(payload->'recurrence','null'::jsonb),payload->'exception_dates') returning id into result;
 else
  select version into current_version from public.private_calendar_events where id=event_id and family_id=actor_family and deleted_at is null for update;
  if current_version is null then raise exception 'Aktiviteten finns inte längre.'; end if;
  if expected_version is null or current_version<>expected_version then raise exception 'Aktiviteten har ändrats på en annan enhet. Stäng och öppna den igen.'; end if;
  update public.private_calendar_events set updated_by=actor_profile,title=trim(payload->>'title'),description=coalesce(payload->>'description',''),location=coalesce(payload->>'location',''),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,all_day=(payload->>'all_day')::boolean,participant_ids=participants,category=payload->>'category',recurrence=nullif(payload->'recurrence','null'::jsonb),exception_dates=payload->'exception_dates',version=version+1 where id=event_id and family_id=actor_family returning id into result;
 end if;
 update public.private_calendar_settings set revision=revision+1 where family_id=actor_family;
 return result;
end;$$;
create function public.calendar_delete(event_id uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare actor_family uuid;
begin
 actor_family:=public.require_calendar_family();
 update public.private_calendar_events set deleted_at=now(),version=version+1 where id=event_id and family_id=actor_family and version=expected_version and deleted_at is null;
 if not found then raise exception 'Aktiviteten har ändrats eller raderats. Uppdatera kalendern.'; end if;
 update public.private_calendar_settings set revision=revision+1 where family_id=actor_family;
end;$$;
create function public.calendar_import(lessons jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare row jsonb; count_rows integer:=0; actor_family uuid;
begin
 actor_family:=public.require_calendar_family();
 if jsonb_typeof(lessons)<>'array' or jsonb_array_length(lessons) not between 1 and 1000 then raise exception 'Importen ska innehålla 1–1000 lektioner.'; end if;
 if exists(select 1 from jsonb_array_elements(lessons) l group by l->>'student_id',l->>'external_id' having count(*)>1) then raise exception 'Dubblerade lektions-ID:n.'; end if;
 for row in select * from jsonb_array_elements(lessons) loop
  if coalesce(public.valid_calendar_date(row->>'term_start'),false)=false or coalesce(public.valid_calendar_date(row->>'term_end'),false)=false then raise exception 'Ogiltig terminsperiod.'; end if;
  if not (row->>'starts_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or not (row->>'ends_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Start och slut krävs i HH:mm.'; end if;
  insert into public.private_school_lessons(family_id,term_confirmed,student_id,external_id,weekday,starts_at,ends_at,subject,room,term_start,term_end,exception_dates)
  values(actor_family,true,row->>'student_id',row->>'external_id',(row->>'weekday')::integer,(row->>'starts_at')::time,(row->>'ends_at')::time,row->>'subject',row->>'room',(row->>'term_start')::date,(row->>'term_end')::date,row->'exception_dates')
  on conflict(family_id,student_id,external_id) do update set term_confirmed=true,weekday=excluded.weekday,starts_at=excluded.starts_at,ends_at=excluded.ends_at,subject=excluded.subject,room=excluded.room,term_start=excluded.term_start,term_end=excluded.term_end,exception_dates=excluded.exception_dates;
  count_rows:=count_rows+1;
 end loop;
 update public.private_calendar_settings set revision=revision+1 where family_id=actor_family;
 return count_rows;
end;$$;
revoke all on function public.calendar_family_id(),public.calendar_identity(),public.require_calendar_family(),public.calendar_snapshot(),public.calendar_save(jsonb,uuid,integer),public.calendar_delete(uuid,integer),public.calendar_import(jsonb) from public,anon,authenticated;
grant execute on function public.calendar_family_id(),public.calendar_identity(),public.require_calendar_family(),public.calendar_snapshot(),public.calendar_save(jsonb,uuid,integer),public.calendar_delete(uuid,integer),public.calendar_import(jsonb) to authenticated;
-- Renaming preserves publication membership. RLS governs Postgres Changes delivery.
-- Helpers for other private tables remain authenticated-only; profiles/families admin-only.
notify pgrst, 'reload schema';
commit;
