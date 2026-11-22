-- Phase 6. Provision access once from the existing server-owned profile binding.
-- No new Auth user, client-selected identity, or display-name matching.
begin;
create table public.personal_week_owners (
 profile_id uuid primary key references public.profiles(id) on delete cascade
);
revoke all on public.personal_week_owners from public,anon,authenticated;
alter table public.personal_week_owners enable row level security;
do $$ begin
 if (select count(*) from public.profiles where profile_key='tobias') <> 1 then
  raise exception 'Min vecka kräver exakt en befintlig Tobias-profil. Kontrollera identitetskopplingen före migrering.';
 end if;
 insert into public.personal_week_owners select id from public.profiles where profile_key='tobias';
end $$;
create function public.personal_week_owner() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p join public.personal_week_owners o on o.profile_id=p.id where p.auth_user_id=(select auth.uid());
$$;
create table public.personal_weeks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.personal_week_owners(profile_id),
 year integer not null check(year between 2000 and 2100), week_number integer not null check(week_number between 1 and 53),
 week_type text not null check(week_type in ('barnvecka','barnfri','specialvecka')),
 focus jsonb not null default '[]', weekly_summary jsonb not null default '{}',
 version integer not null default 1 check(version>0), last_request_id uuid not null, last_request_hash text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,year,week_number), unique(id,owner_id),
 check(extract(isoyear from to_date(year::text||'-'||week_number::text||'-1','IYYY-IW-ID'))=year),
 check(jsonb_typeof(focus)='array' and jsonb_array_length(focus)<=10),
 check(jsonb_typeof(weekly_summary)='object' and octet_length(weekly_summary::text)<=80000)
);
create table public.personal_week_days (
 id uuid primary key default gen_random_uuid(), week_id uuid not null, owner_id uuid not null,
 date date not null, priority text not null default 'normal' check(priority in ('low','normal','high')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(week_id,owner_id) references public.personal_weeks(id,owner_id) on delete cascade,
 unique(week_id,date), unique(id,owner_id)
);
create table public.personal_day_items (
 id uuid primary key default gen_random_uuid(), day_id uuid not null, owner_id uuid not null,
 category text not null check(category in ('work','training','meal','home','family','social','other','selfCare','recovery')),
 content text not null check(length(trim(content)) between 1 and 2000), sort_order integer not null check(sort_order between 0 and 89),
 done boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(day_id,owner_id) references public.personal_week_days(id,owner_id) on delete cascade,
 unique(day_id,sort_order) deferrable initially deferred
);
create table public.personal_week_tasks (
 id uuid primary key default gen_random_uuid(), week_id uuid not null, owner_id uuid not null,
 category text not null check(category in ('work','training','meal','home','family','social','other','selfCare','recovery')),
 task text not null check(length(trim(task)) between 1 and 1000), done boolean not null default false,
 sort_order integer not null check(sort_order between 0 and 99),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(week_id,owner_id) references public.personal_weeks(id,owner_id) on delete cascade,
 unique(week_id,category,task) deferrable initially deferred,
 unique(week_id,sort_order) deferrable initially deferred
);
create index on public.personal_week_days(owner_id,date);
create index on public.personal_day_items(owner_id,category,done);
create index on public.personal_day_items(day_id);
create index on public.personal_week_tasks(owner_id,category,done);
create index on public.personal_week_tasks(week_id);
-- As in the existing repositories: RLS reads, transactional server-owned writes.
do $$ declare t text; begin
 foreach t in array array['personal_weeks','personal_week_days','personal_day_items','personal_week_tasks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy personal_owner_read on public.%I for select to authenticated using(owner_id=(select public.personal_week_owner()))',t);
 end loop;
end $$;
create function public.personal_week_snapshot(target_year integer,target_week integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=public.personal_week_owner(); result jsonb;
begin
 if actor is null then raise exception 'Min vecka är privat. Behörighet saknas.' using errcode='42501'; end if;
 select jsonb_build_object('id',w.id,'owner_id',w.owner_id,'year',w.year,'week_number',w.week_number,'week_type',w.week_type,'focus',w.focus,'weekly_summary',w.weekly_summary,'version',w.version,'updated_at',w.updated_at,
 'days',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'date',d.date,'priority',d.priority,'items',
 (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'category',i.category,'content',i.content,'done',i.done) order by i.sort_order),'[]') from public.personal_day_items i where i.day_id=d.id and i.owner_id=actor)) order by d.date),'[]') from public.personal_week_days d where d.week_id=w.id and d.owner_id=actor),
 'tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'category',t.category,'task',t.task,'done',t.done) order by t.sort_order),'[]') from public.personal_week_tasks t where t.week_id=w.id and t.owner_id=actor)) into result
 from public.personal_weeks w where w.owner_id=actor and w.year=target_year and w.week_number=target_week;
 return result;
end $$;
-- Both manual edits and imports use the same validated, versioned transaction.
-- expected_version NULL means create only; replacement requires an exact version.
create function public.personal_week_save(payload jsonb,expected_version integer,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.personal_week_owner(); w public.personal_weeks; yr integer; wn integer;
 d jsonb; i jsonb; t jsonb; entry record; did uuid; iid uuid; tid uuid; n integer; dt date;
 day_ids uuid[]:='{}'; item_ids uuid[]:='{}'; task_ids uuid[]:='{}'; hashed text;
begin
 if actor is null then raise exception 'Min vecka är privat. Behörighet saknas.' using errcode='42501'; end if;
 if request_id is null or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>800000 then raise exception 'JSON: ogiltig eller för stor veckoplan.'; end if;
 if payload ? 'owner_id' and payload->>'owner_id' is distinct from actor::text then raise exception 'Fel ägare.' using errcode='42501'; end if;
 if jsonb_typeof(payload->'year') is distinct from 'number' or jsonb_typeof(payload->'week_number') is distinct from 'number'
 or payload->>'year' !~ '^\d{4}$' or payload->>'week_number' !~ '^\d{1,2}$' then raise exception 'year/week_number: heltal krävs.'; end if;
 yr:=(payload->>'year')::integer; wn:=(payload->>'week_number')::integer;
 if yr not between 2000 and 2100 or wn not between 1 and 53 or extract(isoyear from to_date(yr::text||'-'||wn::text||'-1','IYYY-IW-ID'))<>yr then raise exception 'year/week_number: ogiltig ISO-vecka.'; end if;
 if jsonb_typeof(payload->'focus') is distinct from 'array' or jsonb_typeof(payload->'weekly_summary') is distinct from 'object'
 or jsonb_typeof(payload->'days') is distinct from 'array' or jsonb_typeof(payload->'tasks') is distinct from 'array' then raise exception 'focus/weekly_summary/days/tasks: fel format.'; end if;
 if jsonb_array_length(payload->'focus')>10 or jsonb_array_length(payload->'days')<>7 or jsonb_array_length(payload->'tasks')>100 then raise exception 'För många poster eller inte exakt sju dagar.'; end if;
 for i in select value from jsonb_array_elements(payload->'focus') loop
  if jsonb_typeof(i)<>'string' or length(trim(i#>>'{}')) not between 1 and 80 then raise exception 'focus: ange 1–80 tecken per etikett.'; end if;
 end loop;
 for entry in select * from jsonb_each(payload->'weekly_summary') loop
  if entry.key not in ('trainingGoal','foodPlan','socialPlan','recovery','economy','reflection') or jsonb_typeof(entry.value)<>'string' or length(entry.value#>>'{}')>3000 then raise exception 'weekly_summary: ogiltigt fält eller textlängd.'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||yr||':'||wn,0));
 select * into w from public.personal_weeks where owner_id=actor and year=yr and week_number=wn for update;
 hashed:=md5(payload::text);
 if w.id is not null and w.last_request_id=request_id then
  if w.last_request_hash<>hashed then raise exception 'Import-ID har redan använts med annat innehåll.'; end if;
  return public.personal_week_snapshot(yr,wn);
 end if;
 if w.id is not null and (expected_version is null or expected_version<>w.version) then raise exception 'Veckan finns redan eller har ändrats. Hämta och granska senaste veckan före ersättning.' using errcode='40001'; end if;
 if w.id is null and expected_version is not null then raise exception 'Veckan finns inte längre. Hämta senaste veckan.' using errcode='40001'; end if;
 if w.id is null then
  insert into public.personal_weeks(owner_id,year,week_number,week_type,focus,weekly_summary,last_request_id,last_request_hash)
  values(actor,yr,wn,payload->>'week_type',payload->'focus',payload->'weekly_summary',request_id,hashed) returning * into w;
 else
  update public.personal_weeks set week_type=payload->>'week_type',focus=payload->'focus',weekly_summary=payload->'weekly_summary',version=version+1,last_request_id=request_id,last_request_hash=hashed,updated_at=now() where id=w.id returning * into w;
 end if;
 for d in select value from jsonb_array_elements(payload->'days') loop
  if jsonb_typeof(d->'date') is distinct from 'string' or d->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'days.date: ogiltigt datum.'; end if;
  dt:=(d->>'date')::date;
  if extract(isoyear from dt)<>yr or extract(week from dt)<>wn then raise exception 'days.date: datumet tillhör inte ISO-veckan.'; end if;
  select id into did from public.personal_week_days where week_id=w.id and date=dt;
  if d ? 'id' and did is distinct from (d->>'id')::uuid then raise exception 'Fel dag-ID eller ägare.' using errcode='42501'; end if;
  did:=coalesce(did,gen_random_uuid());
  if did=any(day_ids) then raise exception 'days.date: dubblerat datum.'; end if;
  day_ids:=array_append(day_ids,did);
  insert into public.personal_week_days(id,week_id,owner_id,date,priority) values(did,w.id,actor,dt,d->>'priority')
  on conflict(id) do update set priority=excluded.priority,updated_at=now();
  if jsonb_typeof(d->'items') is distinct from 'array' or jsonb_array_length(d->'items')>90 then raise exception 'days.items: högst 90 poster.'; end if;
  n:=0;
  for i in select value from jsonb_array_elements(d->'items') loop
   if jsonb_typeof(i->'content') is distinct from 'string' or jsonb_typeof(i->'done') is distinct from 'boolean' then raise exception 'days.items: content ska vara text och done boolean.'; end if;
   iid:=coalesce((i->>'id')::uuid,gen_random_uuid());
   if iid=any(item_ids) then raise exception 'Dubblerat post-ID.'; end if;
   item_ids:=array_append(item_ids,iid);
   insert into public.personal_day_items(id,day_id,owner_id,category,content,sort_order,done) values(iid,did,actor,i->>'category',trim(i->>'content'),n,(i->>'done')::boolean)
   on conflict(id) do update set category=excluded.category,content=excluded.content,sort_order=excluded.sort_order,done=excluded.done,updated_at=now()
   where personal_day_items.day_id=did and personal_day_items.owner_id=actor;
   if not found then raise exception 'Fel post-ID eller ägare.' using errcode='42501'; end if;
   n:=n+1;
  end loop;
 end loop;
 delete from public.personal_day_items where owner_id=actor and day_id=any(day_ids) and not(id=any(item_ids));
 n:=0;
 for t in select value from jsonb_array_elements(payload->'tasks') loop
  if jsonb_typeof(t->'task') is distinct from 'string' or jsonb_typeof(t->'done') is distinct from 'boolean' then raise exception 'tasks: task ska vara text och done boolean.'; end if;
  tid:=coalesce((t->>'id')::uuid,gen_random_uuid());
  if tid=any(task_ids) then raise exception 'Dubblerat uppgifts-ID.'; end if;
  task_ids:=array_append(task_ids,tid);
  insert into public.personal_week_tasks(id,week_id,owner_id,category,task,done,sort_order) values(tid,w.id,actor,t->>'category',trim(t->>'task'),(t->>'done')::boolean,n)
  on conflict(id) do update set category=excluded.category,task=excluded.task,done=excluded.done,sort_order=excluded.sort_order,updated_at=now()
  where personal_week_tasks.week_id=w.id and personal_week_tasks.owner_id=actor;
  if not found then raise exception 'Fel uppgifts-ID eller ägare.' using errcode='42501'; end if;
  n:=n+1;
 end loop;
 delete from public.personal_week_tasks where week_id=w.id and owner_id=actor and not(id=any(task_ids));
 -- Detect duplicate text/order before returning, not after an apparently successful call.
 set constraints all immediate;
 return public.personal_week_snapshot(yr,wn);
end $$;
revoke all on function public.personal_week_owner(),public.personal_week_snapshot(integer,integer),public.personal_week_save(jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function public.personal_week_owner(),public.personal_week_snapshot(integer,integer),public.personal_week_save(jsonb,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
