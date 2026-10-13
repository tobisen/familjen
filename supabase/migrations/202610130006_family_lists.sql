-- Shared private lists. Existing rows and calendar/auth data are preserved.
begin;
alter table public.tasks add column description text not null default '' check(length(description)<=5000),
 add column deadline date, add column priority text not null default 'normal' check(priority in ('low','normal','high')),
 add column recurrence text check(recurrence in ('daily','weekly','monthly')), add column recurrence_anchor date,
 add column recurrence_parent uuid unique references public.tasks(id),
 add column reminder_days integer check(reminder_days between 0 and 365),
 add column created_by uuid, add column completed_by uuid, add column completed_at timestamptz,
 add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(),
 add column version integer not null default 1, add column deleted_at timestamptz, add column client_request_id uuid,
 add unique(id,family_id), add unique(family_id,client_request_id),
 add foreign key(created_by,family_id) references public.profiles(id,family_id),
 add foreign key(completed_by,family_id) references public.profiles(id,family_id),
 add check(recurrence is null or (deadline is not null and recurrence_anchor is not null));
create table public.task_assignees (
 task_id uuid not null, family_id uuid not null, profile_id uuid not null, primary key(task_id,profile_id),
 foreign key(task_id,family_id) references public.tasks(id,family_id) on delete cascade,
 foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
insert into public.task_assignees(task_id,family_id,profile_id) select id,family_id,assigned_to from public.tasks where assigned_to is not null;
alter table public.shopping_items add column amount numeric(10,3) not null default 1 check(amount>0 and amount<=1000000),
 add column unit text not null default '' check(length(unit)<=40), add column created_by uuid,
 add column purchased_by uuid, add column purchased_at timestamptz,
 add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(),
 add column version integer not null default 1, add column deleted_at timestamptz, add column client_request_id uuid,
 add unique(family_id,client_request_id),
 add foreign key(created_by,family_id) references public.profiles(id,family_id),
 add foreign key(purchased_by,family_id) references public.profiles(id,family_id);
-- Preserve old free-text quantities; new entries use structured amount/unit.
update public.shopping_items set unit=left(quantity,40) where quantity is not null;
create index tasks_family_active on public.tasks(family_id,completed,deadline) where deleted_at is null;
create index shopping_family_active on public.shopping_items(family_id,purchased) where deleted_at is null;
alter table public.task_assignees enable row level security;
-- Replace earlier broad member-write policies with RPC-only mutations.
do $$declare t text; p record; begin
 foreach t in array array['tasks','task_assignees','shopping_items'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
   execute format('drop policy %I on public.%I',p.policyname,t);
  end loop;
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy family_read on public.%I for select to authenticated using(family_id=(select public.calendar_family_id()))',t);
 end loop;
end;$$;
create function public.task_next_deadline(current_due date,frequency text,anchor date) returns date
language sql immutable set search_path='' as $$
 select case frequency when 'daily' then current_due+1 when 'weekly' then current_due+7
 when 'monthly' then (date_trunc('month',current_due::timestamp)+interval '1 month')::date+
 (least(extract(day from anchor)::integer,extract(day from date_trunc('month',current_due::timestamp)+interval '2 months'-interval '1 day')::integer)-1) end;
$$;
create function public.lists_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
declare fam uuid:=public.require_calendar_family(); begin
 return jsonb_build_object(
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',profile_key,'name',display_name)),'[]') from public.profiles where family_id=fam and profile_key is not null),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('assigned_ids',(select coalesce(jsonb_agg(p.profile_key order by p.profile_key),'[]') from public.task_assignees a join public.profiles p on p.id=a.profile_id where a.task_id=t.id and a.family_id=fam)) order by t.created_at),'[]') from public.tasks t where family_id=fam and deleted_at is null),
 'shopping',(select coalesce(jsonb_agg(s order by s.created_at),'[]') from public.shopping_items s where family_id=fam and deleted_at is null));
end;$$;
create function public.lists_save(kind text,payload jsonb,item_id uuid default null,expected_version integer default null,request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family(); actor uuid; result uuid; current_version integer; members text[]; due date; freq text;
begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 if kind not in ('task','shopping') or kind is null or jsonb_typeof(payload) is distinct from 'object'
 or coalesce(length(trim(payload->>'title')),0) not between 1 and 200 then raise exception 'Ange en titel på 1–200 tecken.';end if;
 if item_id is null and request_id is null then raise exception 'Registrerings-ID krävs.';end if;
 if kind='task' then
  if jsonb_typeof(payload->'assigned_ids') is distinct from 'array' then raise exception 'Ogiltiga ansvariga.';end if;
  select coalesce(array_agg(x),'{}') into members from jsonb_array_elements_text(payload->'assigned_ids') x;
  if cardinality(members)<>(select count(distinct x) from unnest(members) x) or cardinality(members)<>(select count(*) from public.profiles where family_id=fam and profile_key=any(members)) then raise exception 'Ansvariga måste tillhöra familjen.';end if;
  if length(coalesce(payload->>'description',''))>5000 or coalesce(payload->>'priority','') not in ('low','normal','high') then raise exception 'Ogiltig beskrivning eller prioritet.';end if;
  if nullif(payload->>'deadline','') is not null and not coalesce(public.valid_calendar_date(payload->>'deadline'),false) then raise exception 'Ogiltig deadline.';end if;
  due:=nullif(payload->>'deadline','')::date; freq:=nullif(payload->>'recurrence','');
  if freq is not null and (freq not in ('daily','weekly','monthly') or due is null) then raise exception 'Återkomst kräver giltig deadline.';end if;
  if item_id is null then
   insert into public.tasks(family_id,title,description,deadline,priority,recurrence,recurrence_anchor,reminder_days,created_by,client_request_id)
   values(fam,trim(payload->>'title'),coalesce(payload->>'description',''),due,payload->>'priority',freq,due,(payload->>'reminder_days')::integer,actor,request_id)
   on conflict(family_id,client_request_id) do nothing returning id into result;
   if result is null then select id into result from public.tasks where family_id=fam and client_request_id=request_id;return result;end if;
  else
   select version into current_version from public.tasks where id=item_id and family_id=fam and deleted_at is null for update;
   if current_version is null or expected_version is null or current_version<>expected_version then raise exception 'Uppgiften har ändrats eller raderats. Öppna den på nytt.';end if;
   update public.tasks set title=trim(payload->>'title'),description=coalesce(payload->>'description',''),deadline=due,priority=payload->>'priority',recurrence=freq,
   recurrence_anchor=case when recurrence is not distinct from freq and deadline is not distinct from due then recurrence_anchor else due end,
   reminder_days=(payload->>'reminder_days')::integer,version=version+1,updated_at=now() where id=item_id and family_id=fam returning id into result;
  end if;
  delete from public.task_assignees where task_id=result and family_id=fam;
  insert into public.task_assignees(task_id,family_id,profile_id) select result,fam,id from public.profiles where family_id=fam and profile_key=any(members);
 else
  if coalesce(length(payload->>'unit'),0)>40 then raise exception 'Enheten får ha högst 40 tecken.';end if;
  if item_id is null then
   insert into public.shopping_items(family_id,title,amount,unit,created_by,client_request_id)
   values(fam,trim(payload->>'title'),(payload->>'amount')::numeric,coalesce(payload->>'unit',''),actor,request_id)
   on conflict(family_id,client_request_id) do nothing returning id into result;
   if result is null then select id into result from public.shopping_items where family_id=fam and client_request_id=request_id;end if;
  else
   select version into current_version from public.shopping_items where id=item_id and family_id=fam and deleted_at is null for update;
   if current_version is null or expected_version is null or current_version<>expected_version then raise exception 'Varan har ändrats eller raderats. Öppna den på nytt.';end if;
   update public.shopping_items set title=trim(payload->>'title'),amount=(payload->>'amount')::numeric,unit=coalesce(payload->>'unit',''),version=version+1,updated_at=now() where id=item_id and family_id=fam returning id into result;
  end if;
 end if;
 return result;
end;$$;
create function public.lists_set_done(kind text,item_id uuid,done boolean,expected_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;t public.tasks%rowtype;s public.shopping_items%rowtype;next_id uuid;
begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 if done is null then raise exception 'Ogiltig status.';end if;
 if kind='task' then
  select * into t from public.tasks where id=item_id and family_id=fam and deleted_at is null for update;
  if not found then raise exception 'Uppgiften finns inte längre.';end if;
  if t.completed=done then return item_id;end if;
  if expected_version is null or t.version<>expected_version then raise exception 'Uppgiften har ändrats. Försök igen med senaste versionen.';end if;
  update public.tasks set completed=done,completed_by=case when done then actor end,completed_at=case when done then now() end,version=version+1,updated_at=now() where id=item_id and family_id=fam;
  if done and t.recurrence is not null then
   insert into public.tasks(family_id,title,description,deadline,priority,recurrence,recurrence_anchor,recurrence_parent,reminder_days,created_by)
   values(fam,t.title,t.description,public.task_next_deadline(t.deadline,t.recurrence,t.recurrence_anchor),t.priority,t.recurrence,t.recurrence_anchor,t.id,t.reminder_days,actor)
   on conflict(recurrence_parent) do nothing returning id into next_id;
   if next_id is not null then
    insert into public.task_assignees(task_id,family_id,profile_id) select next_id,family_id,profile_id from public.task_assignees where task_id=t.id and family_id=fam;
   end if;
  end if;
 elsif kind='shopping' then
  select * into s from public.shopping_items where id=item_id and family_id=fam and deleted_at is null for update;
  if not found then raise exception 'Varan finns inte längre.';end if;
  if s.purchased=done then return item_id;end if;
  if expected_version is null or s.version<>expected_version then raise exception 'Varan har ändrats. Försök igen med senaste versionen.';end if;
  update public.shopping_items set purchased=done,purchased_by=case when done then actor end,purchased_at=case when done then now() end,version=version+1,updated_at=now() where id=item_id and family_id=fam;
 else raise exception 'Ogiltig lista.';end if;
 return item_id;
end;$$;
create function public.lists_delete(kind text,item_id uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family(); begin
 if kind='task' then
  update public.tasks set deleted_at=now(),version=version+1,updated_at=now() where id=item_id and family_id=fam and version=expected_version and deleted_at is null;
 elsif kind='shopping' then
  update public.shopping_items set deleted_at=now(),version=version+1,updated_at=now() where id=item_id and family_id=fam and version=expected_version and deleted_at is null;
 else raise exception 'Ogiltig lista.';end if;
 if not found then raise exception 'Posten har ändrats eller raderats. Öppna listan på nytt.';end if;
end;$$;
revoke all on function public.task_next_deadline(date,text,date),public.lists_snapshot(),public.lists_save(text,jsonb,uuid,integer,uuid),public.lists_set_done(text,uuid,boolean,integer),public.lists_delete(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.task_next_deadline(date,text,date),public.lists_snapshot(),public.lists_save(text,jsonb,uuid,integer,uuid),public.lists_set_done(text,uuid,boolean,integer),public.lists_delete(text,uuid,integer) to authenticated;
-- Soft deletion is an UPDATE, so subscribers can remove rows under family RLS.
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['tasks','task_assignees','shopping_items'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
  end loop;
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
