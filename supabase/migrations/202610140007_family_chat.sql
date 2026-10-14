begin;
alter table public.chat_messages add column seq bigint generated always as identity unique,
 add column client_request_id uuid, add column version integer not null default 1,
 add column edited_at timestamptz, add column deleted_at timestamptz,
 add unique(family_id,sender_id,client_request_id), add check(seq<=9007199254740991);
alter table public.chat_messages drop constraint chat_messages_body_check;
alter table public.chat_messages add constraint chat_messages_body_check check(deleted_at is not null or length(trim(body)) between 1 and 10000);
create index chat_family_sequence on public.chat_messages(family_id,seq desc);
create table public.chat_read_states (
 profile_id uuid primary key, family_id uuid not null, last_read_seq bigint not null default 0 check(last_read_seq>=0), updated_at timestamptz not null default now(),
 foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
create table public.notification_preferences (
 profile_id uuid primary key, family_id uuid not null, chat_enabled boolean not null default true,
 foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
create table private.chat_notification_events (
 id uuid primary key default gen_random_uuid(), message_id uuid not null unique references public.chat_messages(id) on delete cascade,
 family_id uuid not null references public.families(id), sender_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), processed_at timestamptz
);
alter table public.chat_read_states enable row level security;
alter table public.notification_preferences enable row level security;
alter table private.chat_notification_events enable row level security;
revoke all on private.chat_notification_events from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,update on private.chat_notification_events to service_role;
do $$declare t text;p record;begin
 foreach t in array array['chat_messages','chat_read_states','notification_preferences'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t);end loop;
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end;$$;
create policy family_read on public.chat_messages for select to authenticated using(family_id=(select public.calendar_family_id()));
create policy own_read on public.chat_read_states for select to authenticated using(family_id=(select public.calendar_family_id()) and public.is_own_profile(profile_id));
create policy own_read on public.notification_preferences for select to authenticated using(family_id=(select public.calendar_family_id()) and public.is_own_profile(profile_id));
create function public.chat_page(before_seq bigint default null,after_seq bigint default null,page_limit integer default 40) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare fam uuid:=public.require_calendar_family();begin
 if page_limit is null or page_limit not between 1 and 100 or (before_seq is not null and after_seq is not null) then raise exception 'Ogiltig sidindelning.';end if;
 if after_seq is not null then
  return (select coalesce(jsonb_agg(m order by m.seq),'[]') from (select * from public.chat_messages where family_id=fam and seq>after_seq order by seq limit page_limit) m);
 end if;
 return (select coalesce(jsonb_agg(m order by m.seq),'[]') from (select * from public.chat_messages where family_id=fam and (before_seq is null or seq<before_seq) order by seq desc limit page_limit) m);
end;$$;
create function public.chat_summary() returns jsonb language plpgsql security invoker set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;cursor_seq bigint;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 select coalesce((select last_read_seq from public.chat_read_states where profile_id=actor),0) into cursor_seq;
 return jsonb_build_object('last_message',(select to_jsonb(m) from public.chat_messages m where family_id=fam and deleted_at is null order by seq desc limit 1),
 'unread',(select count(*) from public.chat_messages where family_id=fam and sender_id<>actor and deleted_at is null and seq>cursor_seq),
 'last_read_seq',cursor_seq,'chat_enabled',coalesce((select chat_enabled from public.notification_preferences where profile_id=actor),true),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',profile_key,'name',display_name)),'[]') from public.profiles where family_id=fam and profile_key is not null));
end;$$;
create function public.chat_send(message_body text,request_id uuid) returns public.chat_messages
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;result public.chat_messages%rowtype;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 if request_id is null or coalesce(length(trim(message_body)),0) not between 1 and 10000 then raise exception 'Meddelandet ska innehålla 1–10 000 tecken.';end if;
 -- Serialize sends within the family, so sequence order also follows commit order.
 perform pg_advisory_xact_lock(hashtextextended('chat-send:'||fam::text,0));
 select * into result from public.chat_messages where family_id=fam and sender_id=actor and client_request_id=request_id;
 if found then return result;end if;
 insert into public.chat_messages(family_id,sender_id,body,client_request_id) values(fam,actor,trim(message_body),request_id) returning * into result;
 insert into private.chat_notification_events(message_id,family_id,sender_id) values(result.id,fam,actor);
 return result;
end;$$;
create function public.chat_change(message_id uuid,message_body text,expected_version integer,remove_message boolean default false) returns public.chat_messages
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;result public.chat_messages%rowtype;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 select * into result from public.chat_messages where id=message_id and family_id=fam and sender_id=actor for update;
 if not found then raise exception 'Du kan bara ändra dina egna meddelanden.' using errcode='42501';end if;
 if result.deleted_at is not null then
  if remove_message is true then return result;end if;
  raise exception 'Meddelandet har raderats.';
 end if;
 if expected_version is null or expected_version<>result.version then raise exception 'Meddelandet har ändrats. Öppna det på nytt.';end if;
 if remove_message is null or (not remove_message and coalesce(length(trim(message_body)),0) not between 1 and 10000) then raise exception 'Ogiltigt meddelande.';end if;
 update public.chat_messages set body=case when remove_message then '' else trim(message_body) end,
 edited_at=case when remove_message then edited_at else now() end,deleted_at=case when remove_message then now() end,version=version+1
 where id=message_id and family_id=fam and sender_id=actor returning * into result;
 return result;
end;$$;
create function public.chat_mark_read(through_seq bigint) returns void language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;ceiling bigint;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 select coalesce(max(seq),0) into ceiling from public.chat_messages where family_id=fam;
 if through_seq is null or through_seq<0 or through_seq>ceiling then raise exception 'Ogiltig läsmarkering.';end if;
 insert into public.chat_read_states(profile_id,family_id,last_read_seq) values(actor,fam,through_seq)
 on conflict(profile_id) do update set last_read_seq=greatest(public.chat_read_states.last_read_seq,excluded.last_read_seq),updated_at=now();
end;$$;
create function public.chat_preferences(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid());
 if enabled is null then raise exception 'Ogiltigt notisval.';end if;
 insert into public.notification_preferences(profile_id,family_id,chat_enabled) values(actor,fam,enabled)
 on conflict(profile_id) do update set chat_enabled=excluded.chat_enabled;
end;$$;
revoke all on function public.chat_page(bigint,bigint,integer),public.chat_summary(),public.chat_send(text,uuid),public.chat_change(uuid,text,integer,boolean),public.chat_mark_read(bigint),public.chat_preferences(boolean) from public,anon,authenticated;
grant execute on function public.chat_page(bigint,bigint,integer),public.chat_summary(),public.chat_send(text,uuid),public.chat_change(uuid,text,integer,boolean),public.chat_mark_read(bigint),public.chat_preferences(boolean) to authenticated;
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['chat_messages','chat_read_states','notification_preferences'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
  end loop;
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
