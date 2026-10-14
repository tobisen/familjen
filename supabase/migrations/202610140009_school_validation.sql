-- Validate drafts on the server as well as on the client.
begin;
create or replace function public.school_save(payload jsonb, expected_version integer default null, activate boolean default false, replace_missing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f uuid; student text; period text; old public.private_school_imports; saved public.private_school_imports;
 l jsonb; rows jsonb:='[]'; ids text[]:='{}'; n integer:=0; eid text;
begin
 f:=public.require_calendar_family(); student:=payload->>'student_id'; period:=payload->>'period_key';
 if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'source') is distinct from 'string' or coalesce(length(trim(payload->>'source')),0) not between 1 and 1000 or
 jsonb_typeof(payload->'exception_dates') is distinct from 'array' or not(payload ? 'term_start' and payload ? 'term_end') or
 (payload ? 'notes' and jsonb_typeof(payload->'notes')<>'string') or (payload ? 'date_source' and jsonb_typeof(payload->'date_source')<>'string') then raise exception 'Ogiltiga schemametadata.'; end if;
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
  if jsonb_typeof(l->'external_id') is distinct from 'string' or jsonb_typeof(l->'subject') is distinct from 'string' or
   coalesce(jsonb_typeof(l->'room') in ('string','null'),false)=false or
   coalesce(jsonb_typeof(l->'starts_at') in ('string','null'),false)=false or coalesce(jsonb_typeof(l->'ends_at') in ('string','null'),false)=false or
   (l ? 'uncertainty' and jsonb_typeof(l->'uncertainty')<>'string') then raise exception 'Ogiltiga lektionsfält.'; end if;
  if jsonb_typeof(l) is distinct from 'object' or coalesce(length(trim(l->>'external_id')),0) not between 1 and 120 or coalesce(length(trim(l->>'subject')),0) not between 1 and 200 or
   coalesce((l->>'weekday')::integer,0) not between 1 and 7 or length(l->>'room')>200 or
   (l ? 'confirmed' and jsonb_typeof(l->'confirmed')<>'boolean') or
   ((l->>'starts_at') is not null and (l->>'starts_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or
   ((l->>'ends_at') is not null and (l->>'ends_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Ogiltig lektion.'; end if;
  if l ? 'exception_dates' and (jsonb_typeof(l->'exception_dates') is distinct from 'array' or coalesce(public.valid_calendar_dates(l->'exception_dates'),false)=false) then raise exception 'Ogiltiga lektionsavvikelser.'; end if;
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
commit;
