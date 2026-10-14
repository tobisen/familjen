-- Private draft administration. Weekly lessons still use calendar_import and
-- calendar_snapshot; periods namespace external IDs, leaving family events intact.
begin;
create table public.private_school_imports (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id),
 student_id text not null check(student_id in ('neo','sally')),
 period_key text not null check(period_key ~ '^[a-zA-Z0-9_-]{1,60}$'),
 draft jsonb not null check(jsonb_typeof(draft)='object'),
 version integer not null default 1,
 active_ids text[] not null default '{}',
 activated_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(family_id,student_id,period_key)
);
alter table public.private_school_imports enable row level security;
revoke all on public.private_school_imports from public,anon,authenticated;
grant select on public.private_school_imports to authenticated;
create policy family_read on public.private_school_imports for select to authenticated
 using(family_id=(select public.calendar_family_id()));
create function public.school_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
 f:=public.require_calendar_family();
 return (select coalesce(jsonb_agg(s order by student_id,period_key),'[]') from public.private_school_imports s where family_id=f);
end;$$;
create function public.school_save(payload jsonb, expected_version integer default null, activate boolean default false, replace_missing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f uuid; student text; period text; old public.private_school_imports; saved public.private_school_imports;
 l jsonb; rows jsonb:='[]'; ids text[]:='{}'; n integer:=0; eid text;
begin
 f:=public.require_calendar_family(); student:=payload->>'student_id'; period:=payload->>'period_key';
 if student is null or student not in ('neo','sally') or period is null or period !~ '^[a-zA-Z0-9_-]{1,60}$' or length(payload::text)>2000000 or
 jsonb_typeof(payload->'lessons') is distinct from 'array' or jsonb_array_length(payload->'lessons')>1000 or
 coalesce(public.valid_calendar_dates(payload->'exception_dates'),false)=false then raise exception 'Ogiltigt schemaunderlag.'; end if;
 -- Serialize saves to the same student/period, including first insert.
 perform pg_advisory_xact_lock(hashtextextended(f::text||student||period,0));
 select * into old from public.private_school_imports where family_id=f and student_id=student and period_key=period for update;
 if (old.id is not null and expected_version is distinct from old.version) or (old.id is null and expected_version is not null) then raise exception 'Schemat ändrades på en annan enhet. Hämta igen.'; end if;
 if ((payload->>'term_start') is not null and not public.valid_calendar_date(payload->>'term_start')) or ((payload->>'term_end') is not null and not public.valid_calendar_date(payload->>'term_end')) then raise exception 'Ogiltiga datum.'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'lessons') x group by x->>'external_id' having count(*)>1) then raise exception 'Dubblerade lektions-ID:n.'; end if;
 for l in select * from jsonb_array_elements(payload->'lessons') loop
  if jsonb_typeof(l) is distinct from 'object' or coalesce(length(trim(l->>'external_id')),0) not between 1 and 120 or coalesce(length(trim(l->>'subject')),0) not between 1 and 200 or
   coalesce((l->>'weekday')::integer,0) not between 1 and 7 or length(l->>'room')>200 or
   (l ? 'confirmed' and jsonb_typeof(l->'confirmed')<>'boolean') or
   ((l->>'starts_at') is not null and (l->>'starts_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or
   ((l->>'ends_at') is not null and (l->>'ends_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Ogiltig lektion.'; end if;
  if l ? 'exception_dates' and coalesce(public.valid_calendar_dates(l->'exception_dates'),false)=false then raise exception 'Ogiltiga lektionsavvikelser.'; end if;
  if activate and coalesce((l->>'confirmed')::boolean,true) and l->>'starts_at' is not null and l->>'ends_at' is not null and l->>'starts_at'<l->>'ends_at' then
   eid:='period:'||period||':'||(l->>'external_id');
   ids:=array_append(ids,eid);
   rows:=rows||jsonb_build_array(l||jsonb_build_object('external_id',eid,'student_id',student,'term_start',payload->'term_start','term_end',payload->'term_end','exception_dates',(select coalesce(jsonb_agg(distinct d),'[]') from jsonb_array_elements((payload->'exception_dates')||coalesce(l->'exception_dates','[]')) d)));
  end if;
 end loop;
 if activate then
  if coalesce(public.valid_calendar_date(payload->>'term_start'),false)=false or coalesce(public.valid_calendar_date(payload->>'term_end'),false)=false or payload->>'term_end'<payload->>'term_start' then raise exception 'Bekräftad terminsstart och terminsslut krävs.'; end if;
  if jsonb_array_length(rows)=0 then raise exception 'Inga verifierade lektioner med fullständiga tider.'; end if;
  n:=public.calendar_import(rows);
  if replace_missing then
   delete from public.private_school_lessons where family_id=f and student_id=student and external_id=any(old.active_ids) and not(external_id=any(ids));
  else ids:=array(select distinct unnest(coalesce(old.active_ids,'{}')||ids)); end if;
 else ids:=coalesce(old.active_ids,'{}'); end if;
 insert into public.private_school_imports(family_id,student_id,period_key,draft,active_ids,activated_at)
 values(f,student,period,payload,ids,case when activate then now() end)
 on conflict(family_id,student_id,period_key) do update set draft=excluded.draft,version=private_school_imports.version+1,active_ids=excluded.active_ids,activated_at=coalesce(excluded.activated_at,private_school_imports.activated_at),updated_at=now()
 returning * into saved;
 update public.private_calendar_settings set revision=revision+1 where family_id=f;
 return jsonb_build_object('record',to_jsonb(saved),'count',n);
end;$$;
revoke all on function public.school_snapshot(),public.school_save(jsonb,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.school_snapshot(),public.school_save(jsonb,integer,boolean,boolean) to authenticated;
-- Harden legacy import too: SQL null must not bypass the time validation.
create or replace function public.calendar_import(lessons jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare row jsonb; count_rows integer:=0; actor_family uuid;
begin
 actor_family:=public.require_calendar_family();
 if jsonb_typeof(lessons)<>'array' or jsonb_array_length(lessons) not between 1 and 1000 then raise exception 'Importen ska innehålla 1–1000 lektioner.'; end if;
 if exists(select 1 from jsonb_array_elements(lessons) l group by l->>'student_id',l->>'external_id' having count(*)>1) then raise exception 'Dubblerade lektions-ID:n.'; end if;
 for row in select * from jsonb_array_elements(lessons) loop
  if coalesce(public.valid_calendar_date(row->>'term_start'),false)=false or coalesce(public.valid_calendar_date(row->>'term_end'),false)=false then raise exception 'Ogiltig terminsperiod.'; end if;
  if row->>'starts_at' is null or row->>'ends_at' is null or not (row->>'starts_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or not (row->>'ends_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Start och slut krävs i HH:mm.'; end if;
  insert into public.private_school_lessons(family_id,term_confirmed,student_id,external_id,weekday,starts_at,ends_at,subject,room,term_start,term_end,exception_dates)
  values(actor_family,true,row->>'student_id',row->>'external_id',(row->>'weekday')::integer,(row->>'starts_at')::time,(row->>'ends_at')::time,row->>'subject',row->>'room',(row->>'term_start')::date,(row->>'term_end')::date,row->'exception_dates')
  on conflict(family_id,student_id,external_id) do update set term_confirmed=true,weekday=excluded.weekday,starts_at=excluded.starts_at,ends_at=excluded.ends_at,subject=excluded.subject,room=excluded.room,term_start=excluded.term_start,term_end=excluded.term_end,exception_dates=excluded.exception_dates;
  count_rows:=count_rows+1;
 end loop;
 update public.private_calendar_settings set revision=revision+1 where family_id=actor_family;
 return count_rows;
end;$$;

commit;
