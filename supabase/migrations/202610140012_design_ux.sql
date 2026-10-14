begin;
-- Content-free family invalidation survives RLS hiding a deleted message.
create table public.chat_revisions (
 family_id uuid primary key references public.families(id) on delete cascade,
 revision bigint not null default 0
);
alter table public.chat_revisions enable row level security;
revoke all on public.chat_revisions from public,anon,authenticated;
grant select on public.chat_revisions to authenticated;
create policy family_read on public.chat_revisions for select to authenticated using(family_id=(select public.calendar_family_id()));
insert into public.chat_revisions(family_id) select id from public.families;
create function private.chat_revision_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.chat_revisions(family_id,revision) values(new.family_id,1)
 on conflict(family_id) do update set revision=public.chat_revisions.revision+1;
 return new;
end;$$;
revoke all on function private.chat_revision_changed() from public,anon,authenticated;
create trigger chat_revision_changed after insert or update on public.chat_messages for each row execute function private.chat_revision_changed();
-- Historical tombstones contain no text; active messages are untouched.
update public.chat_messages set body='' where deleted_at is not null and body<>'';
drop policy family_read on public.chat_messages;
create policy family_read on public.chat_messages for select to authenticated using(family_id=(select public.calendar_family_id()) and deleted_at is null);
-- Existing invoker page/summary queries now exclude tombstones through RLS,
-- including direct table reads and Realtime authorization.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.chat_revisions;
 end if;
end;$$;

create function public.calendar_participate(event_id uuid,expected_version integer,joining boolean) returns void
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;key text;e public.private_calendar_events%rowtype;members text[];
begin
 select id,profile_key into actor,key from public.profiles where auth_user_id=(select auth.uid()) and family_id=fam;
 if key is null or joining is null then raise exception 'Identitet saknas.' using errcode='42501';end if;
 select * into e from public.private_calendar_events where id=event_id and family_id=fam and deleted_at is null for update;
 if not found or expected_version is distinct from e.version then raise exception 'Aktiviteten har ändrats. Öppna den igen.';end if;
 members:=e.participant_ids;
 if joining then
  if key=any(members) then return;end if;
  members:=array_append(members,key);
 else
  members:=array_remove(members,key);
  if cardinality(members)=0 then raise exception 'Minst en deltagare behövs.';end if;
 end if;
 update public.private_calendar_events set participant_ids=members,updated_by=actor,version=version+1 where id=e.id;
 update public.private_calendar_settings set revision=revision+1 where family_id=fam;
end;$$;

create function public.task_assign_self(item_id uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;t public.tasks%rowtype;
begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid()) and family_id=fam;
 select * into t from public.tasks where id=item_id and family_id=fam and deleted_at is null for update;
 if not found or expected_version is distinct from t.version or t.completed then raise exception 'Uppgiften har ändrats. Öppna den igen.';end if;
 insert into public.task_assignees(task_id,profile_id,family_id) values(t.id,actor,fam) on conflict do nothing;
 if found then update public.tasks set updated_at=now(),version=version+1 where id=t.id;end if;
end;$$;

-- Atomic exception + replacement: concurrent attempts fail the series version
-- check, so retry cannot create a second replacement or lose the original.
create function public.calendar_save_occurrence(payload jsonb,event_id uuid,occurrence_date date,expected_version integer) returns uuid
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
 return result;
end;$$;
revoke all on function public.calendar_participate(uuid,integer,boolean),public.task_assign_self(uuid,integer),public.calendar_save_occurrence(jsonb,uuid,date,integer) from public,anon,authenticated;
grant execute on function public.calendar_participate(uuid,integer,boolean),public.task_assign_self(uuid,integer),public.calendar_save_occurrence(jsonb,uuid,date,integer) to authenticated;
notify pgrst,'reload schema';
commit;
