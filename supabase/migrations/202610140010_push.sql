begin;
-- All business notifications are mandatory. Legacy clients cannot mute them.
update public.notification_preferences set chat_enabled=true;
alter table private.chat_notification_events alter column processed_at set default now();
update private.chat_notification_events set processed_at=now() where processed_at is null;
create or replace function public.chat_preferences(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_calendar_family(); if enabled is distinct from true then raise exception 'Notiser styrs av telefonens behörighet.'; end if; end;$$;
do $$declare p record;begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='push_subscriptions' loop execute format('drop policy %I on public.push_subscriptions',p.policyname);end loop;
end;$$;
revoke all on public.push_subscriptions from public,anon,authenticated;
alter table public.push_subscriptions add column session_id uuid references auth.sessions(id) on delete cascade, add column active boolean not null default true, add column updated_at timestamptz not null default now();
update public.push_subscriptions set active=false where session_id is null;
-- Endpoints and encryption keys are accessible through own-session RPC only.
create table private.push_jobs (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 recipient_id uuid not null, dedupe_key text not null, kind text not null, object_id uuid,
 payload jsonb not null, due_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour',
 canceled boolean not null default false, created_at timestamptz not null default now(),
 foreign key(recipient_id,family_id) references public.profiles(id,family_id), unique(recipient_id,dedupe_key)
);
create table private.push_deliveries (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references private.push_jobs(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,next_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 result_code integer, unique(job_id,subscription_id)
);
alter table private.push_jobs enable row level security;
alter table private.push_deliveries enable row level security;
revoke all on private.push_jobs,private.push_deliveries from public,anon,authenticated;
create index push_due on private.push_jobs(due_at,expires_at) where not canceled;
create index push_retry on private.push_deliveries(next_at) where status in ('pending','sending');
create function public.push_register(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid:=public.require_calendar_family(); actor uuid; result uuid; sid uuid; ep text:=payload->>'endpoint';begin
 select id into actor from public.profiles where auth_user_id=auth.uid();
 sid:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
 if not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then raise exception 'Registrerad session krävs.';end if;
 perform pg_advisory_xact_lock(hashtextextended('push-register:'||actor,0));
 if length(ep)>4096 or ep !~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)/[^\s#]+$' or ep is null
 or coalesce(payload->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}={0,2}$' or coalesce(payload->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Ogiltig pushprenumeration.';end if;
 if (select count(*) from public.push_subscriptions where profile_id=actor and active)>=20 and not exists(select 1 from public.push_subscriptions s where s.endpoint=ep and s.profile_id=actor) then raise exception 'För många enheter. Kontakta administratören.';end if;
 insert into public.push_subscriptions(family_id,profile_id,endpoint,session_id,subscription) values(f,actor,ep,sid,jsonb_build_object('endpoint',ep,'keys',payload->'keys'))
 on conflict(endpoint) do update set subscription=excluded.subscription,session_id=excluded.session_id,active=true,updated_at=now() where push_subscriptions.profile_id=actor and push_subscriptions.family_id=f returning id into result;
 if result is null then raise exception 'Prenumerationen tillhör en annan registrering.';end if;
 return result;
end;$$;
create function public.push_forget(push_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_calendar_family();update public.push_subscriptions set active=false where endpoint=push_endpoint and profile_id=(select id from public.profiles where auth_user_id=auth.uid());end;$$;
create function private.push_add(f uuid,recipient uuid,k text,kind text,obj uuid,title text,body text,path text,due timestamptz default now(),expiry timestamptz default now()+interval '1 hour') returns void language sql security definer set search_path='' as $$
 insert into private.push_jobs(family_id,recipient_id,dedupe_key,kind,object_id,payload,due_at,expires_at)
 select f,recipient,k,kind,obj,jsonb_build_object('title',left(title,160),'body',left(body,350),'path',path,'recipient',recipient),due,expiry
 where exists(select 1 from public.profiles where id=recipient and family_id=f and auth_user_id is not null)
 on conflict(recipient_id,dedupe_key) do nothing;
$$;
create function public.push_test() returns void language plpgsql security definer set search_path='' as $$
declare f uuid:=public.require_calendar_family();actor uuid;begin
 select id into actor from public.profiles where auth_user_id=auth.uid();
 perform pg_advisory_xact_lock(hashtextextended('push-test:'||actor,0));
 if not exists(select 1 from public.push_subscriptions where profile_id=actor and active) then raise exception 'Aktivera notiser på enheten först.';end if;
 if exists(select 1 from private.push_jobs where recipient_id=actor and kind='test' and created_at>now()-interval '1 minute') then raise exception 'Vänta en minut innan nästa test.';end if;
 perform private.push_add(f,actor,'test:'||gen_random_uuid(),'test',null,'Familjen','Testnotis – din enhet är ansluten.','/installningar');
end;$$;
alter table public.tasks add column push_previous_assignees text[] not null default '{}';
create function private.push_task_before() returns trigger language plpgsql security definer set search_path='' as $$
begin new.push_previous_assignees:=array(select p.profile_key from public.task_assignees a join public.profiles p on p.id=a.profile_id where a.task_id=new.id and a.family_id=new.family_id);return new;end;$$;
revoke all on function private.push_task_before() from public,anon,authenticated;
create trigger push_task_before before update on public.tasks for each row execute function private.push_task_before();
create function private.push_on_change() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; recipient record; f uuid:=new.family_id; title text; body text; path text; kind text; keys text[]; k text; bucket text;begin
 select id into actor from public.profiles where auth_user_id=auth.uid() and family_id=f;
 if tg_table_name='chat_messages' then
  if tg_op<>'INSERT' then
   if new.deleted_at is not null then update private.push_jobs j set canceled=true where j.object_id=new.id and j.family_id=f and j.kind='chat';end if;
   return new;
  end if;
  actor:=new.sender_id;kind:='chat';title:=(select display_name from public.profiles where id=actor);body:=new.body;path:='/chatt?message='||new.id;k:='chat:'||new.id;
 elsif tg_table_name='shopping_items' then
  if tg_op<>'INSERT' then return new;end if;
  actor:=new.created_by;kind:='shopping';title:='Nytt på inköpslistan';body:=new.title;path:='/listor?tab=inkop';
  bucket:=floor(extract(epoch from now())/120)::bigint::text;k:='shopping:'||f||':'||bucket;
 elsif tg_table_name='private_calendar_events' then
  actor:=coalesce(new.updated_by,actor);keys:=new.participant_ids;
  if tg_op='UPDATE' then
   keys:=array(select distinct unnest(old.participant_ids||new.participant_ids));
   update private.push_jobs j set canceled=true where j.object_id=new.id and j.family_id=f and j.kind in ('activity','activity-reminder');
  end if;
  kind:='activity';title:=case when new.deleted_at is not null then 'Inställd aktivitet' when tg_op='INSERT' then 'Ny aktivitet' else 'Ändrad aktivitet' end;body:=new.title;path:='/kalender?activity='||new.id;k:='activity:'||new.id||':'||new.version;
 elsif tg_table_name='tasks' then
  keys:=array(select p.profile_key from public.task_assignees a join public.profiles p on p.id=a.profile_id where a.task_id=new.id and a.family_id=f);
  if tg_op='UPDATE' then
   update private.push_jobs j set canceled=true where j.object_id=new.id and j.family_id=f and j.kind in ('task','task-due','task-overdue');
   if new.completed is not distinct from old.completed and new.title=old.title and new.description=old.description and new.deadline is not distinct from old.deadline and new.priority=old.priority and new.deleted_at is null then
    -- Assignment-only edits are still significant; the RPC increments version.
    null;
   end if;
  end if;
  keys:=array(select distinct unnest(keys||new.push_previous_assignees));
  if new.deleted_at is not null then return new;end if;
  if new.completed then keys:=array(select distinct unnest(keys||array[(select profile_key from public.profiles where id=new.created_by)]));end if;
  kind:='task';title:=case when new.completed then 'Uppgift klar' when tg_op='INSERT' then 'Ny tilldelad uppgift' else 'Ändrad uppgift' end;body:=new.title;path:='/listor?tab=todo&task='||new.id;k:='task:'||new.id||':'||new.version;
 end if;
 for recipient in select * from public.profiles where family_id=f and auth_user_id is not null and id is distinct from actor and (keys is null or profile_key=any(keys)) loop
  if kind='shopping' then
   insert into private.push_jobs(family_id,recipient_id,dedupe_key,kind,object_id,payload,due_at)
   values(f,recipient.id,k,kind,null,jsonb_build_object('title',title,'body',left(body,120),'path',path,'recipient',recipient.id,'count',1),now()+interval '2 minutes')
   on conflict(recipient_id,dedupe_key) do update set payload=private.push_jobs.payload||jsonb_build_object('count',(private.push_jobs.payload->>'count')::integer+1,'body',left((private.push_jobs.payload->>'body')||', '||(excluded.payload->>'body'),350));
  else perform private.push_add(f,recipient.id,k,kind,new.id,title,body,path);end if;
 end loop;
 return new;
end;$$;
create function private.push_school_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or row(new.starts_at,new.ends_at,new.subject,new.term_start,new.term_end,new.exception_dates) is distinct from row(old.starts_at,old.ends_at,old.subject,old.term_start,old.term_end,old.exception_dates) then
 update private.push_jobs set canceled=true where object_id=old.id and family_id=old.family_id and kind='school-reminder';end if;
 return coalesce(new,old);
end;$$;
revoke all on function private.push_school_change() from public,anon,authenticated;
create trigger push_school_change after update or delete on public.private_school_lessons for each row execute function private.push_school_change();
create trigger push_chat after insert or update on public.chat_messages for each row execute function private.push_on_change();
create trigger push_calendar after insert or update on public.private_calendar_events for each row execute function private.push_on_change();
create trigger push_shopping after insert on public.shopping_items for each row execute function private.push_on_change();
-- Deferral ensures final task assignments exist before recipient selection.
create constraint trigger push_tasks after insert or update on public.tasks deferrable initially deferred for each row execute function private.push_on_change();
-- Deletion must record the verified actor, not a previous editor.
create or replace function public.calendar_delete(event_id uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare f uuid:=public.require_calendar_family();begin
 update public.private_calendar_events set deleted_at=now(),version=version+1,updated_by=(select id from public.profiles where auth_user_id=auth.uid()) where id=event_id and family_id=f and version=expected_version and deleted_at is null;
 if not found then raise exception 'Aktiviteten har ändrats eller raderats. Uppdatera kalendern.';end if;
 update public.private_calendar_settings set revision=revision+1 where family_id=f;
end;$$;
create function public.push_schedule_snapshot() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('activities',(select coalesce(jsonb_agg(e),'[]') from public.private_calendar_events e where deleted_at is null),'lessons',(select coalesce(jsonb_agg(l),'[]') from public.private_school_lessons l where term_confirmed),'tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('recipients',(select coalesce(jsonb_agg(profile_id),'[]') from public.task_assignees where task_id=t.id and family_id=t.family_id))),'[]') from public.tasks t where deleted_at is null and not completed and deadline is not null));
$$;
create function public.push_reminders(items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare i jsonb;r record;keys text[];begin
 for i in select * from jsonb_array_elements(items) loop
  if i->>'kind'='activity-reminder' then
   select participant_ids into keys from public.private_calendar_events where id=(i->>'id')::uuid and family_id=(i->>'family')::uuid and deleted_at is null;
  elsif i->>'kind'='school-reminder' then
   select array[student_id] into keys from public.private_school_lessons where id=(i->>'id')::uuid and family_id=(i->>'family')::uuid and term_confirmed;
  else
   select array_agg(p.profile_key) into keys from public.task_assignees a join public.profiles p on p.id=a.profile_id join public.tasks t on t.id=a.task_id where t.id=(i->>'id')::uuid and t.family_id=(i->>'family')::uuid and not t.completed and t.deleted_at is null;
  end if;
  if keys is null then continue;end if;
  for r in select id from public.profiles where family_id=(i->>'family')::uuid and profile_key=any(keys) loop
   perform private.push_add((i->>'family')::uuid,r.id,i->>'key',i->>'kind',(i->>'id')::uuid,i->>'title',i->>'body',i->>'path',now(),(i->>'expires')::timestamptz);
  end loop;
 end loop;
end;$$;
create function public.push_claim(batch_limit integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb;
begin
 insert into private.push_deliveries(job_id,subscription_id)
 select j.id,s.id from private.push_jobs j join public.push_subscriptions s on s.profile_id=j.recipient_id and s.family_id=j.family_id and s.active
 join public.profiles p on p.id=s.profile_id join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id
 where not j.canceled and j.due_at<=now() and j.expires_at>now() on conflict do nothing;
 with candidates as (
 select d.id from private.push_deliveries d join private.push_jobs j on j.id=d.job_id join public.push_subscriptions s on s.id=d.subscription_id join public.profiles p on p.id=s.profile_id join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id
 where not j.canceled and j.expires_at>now() and s.active and s.profile_id=j.recipient_id and s.family_id=j.family_id and d.attempts<6 and d.next_at<=now()
 and (d.status='pending' or (d.status='sending' and d.lease_until<now())) order by d.next_at limit least(greatest(batch_limit,1),50) for update of d skip locked
 ), leased as(update private.push_deliveries d set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() from candidates c where d.id=c.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'lease',d.lease_token,'job',j.id,'subscription',s.subscription,'payload',j.payload||jsonb_build_object('id',j.id,'kind',j.kind),'expires',j.expires_at)),'[]') into output from leased d join private.push_jobs j on j.id=d.job_id join public.push_subscriptions s on s.id=d.subscription_id;
 return output;
end;$$;
create function public.push_finish(delivery_id uuid,lease uuid,result integer) returns void language plpgsql security definer set search_path='' as $$
declare d private.push_deliveries;begin
 select * into d from private.push_deliveries where id=delivery_id and lease_token=lease and status='sending' for update;
 if not found then return;end if;
 update private.push_deliveries set status=case when result between 200 and 299 then 'sent' when result in (404,410) or attempts>=6 or (result between 400 and 499 and result<>429) then 'failed' else 'pending' end,
 result_code=result,next_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),lease_until=null where id=d.id;
 if result in (404,410) then update public.push_subscriptions set active=false where id=d.subscription_id;end if;
end;$$;
create function public.push_cleanup() returns void language sql security definer set search_path='' as $$
 delete from private.push_jobs where expires_at<now()-interval '7 days';
$$;
revoke all on function public.push_cleanup() from public,anon,authenticated;
grant execute on function public.push_cleanup() to service_role;
-- Private queues are not PostgREST schemas. Only server RPCs expose work to service_role.
revoke all on function private.push_add(uuid,uuid,text,text,uuid,text,text,text,timestamptz,timestamptz),private.push_on_change() from public,anon,authenticated;
revoke all on function public.push_register(jsonb),public.push_forget(text),public.push_test(),public.push_schedule_snapshot(),public.push_reminders(jsonb),public.push_claim(integer),public.push_finish(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.push_register(jsonb),public.push_forget(text),public.push_test() to authenticated;
grant execute on function public.push_schedule_snapshot(),public.push_reminders(jsonb),public.push_claim(integer),public.push_finish(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
