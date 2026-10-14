begin;
alter table public.positions add column received_at timestamptz not null default now();
alter table public.positions add constraint position_accuracy_reasonable check(accuracy between 0 and 1000000);
do $$declare p record;begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='positions' loop execute format('drop policy %I on public.positions',p.policyname);end loop;
end;$$;
revoke all on public.positions from public,anon,authenticated;
grant select on public.positions to authenticated;
create policy family_read on public.positions for select to authenticated using(family_id=(select public.calendar_family_id()));
create function public.map_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
declare fam uuid:=public.require_calendar_family();begin
 return jsonb_build_object('people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',profile_key,'name',display_name)),'[]') from public.profiles where family_id=fam and profile_key is not null),
 'positions',(select coalesce(jsonb_agg(p),'[]') from public.positions p where family_id=fam));
end;$$;
create function public.map_report(latitude double precision,longitude double precision,accuracy double precision,recorded_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;result public.positions%rowtype;begin
 select id into actor from public.profiles where auth_user_id=(select auth.uid()) and family_id=fam;
 if latitude is null or longitude is null or accuracy is null or recorded_at is null or latitude not between -90 and 90 or longitude not between -180 and 180 or accuracy not between 0 and 1000000 or recorded_at>now()+interval '30 seconds' or recorded_at<now()-interval '2 minutes' then raise exception 'GPS-positionen är ogiltig eller för gammal.';end if;
 insert into public.positions as p(profile_id,family_id,latitude,longitude,accuracy,reported_at,received_at)
 values(actor,fam,latitude,longitude,accuracy,recorded_at,now())
 on conflict(profile_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,reported_at=excluded.reported_at,received_at=now()
 where p.family_id=fam and p.reported_at<excluded.reported_at and p.received_at<=now()-interval '5 seconds' returning * into result;
 return jsonb_build_object('accepted',result.profile_id is not null);
end;$$;
alter table public.chat_messages add column kind text not null default 'message' check(kind in ('message','help')), add column map_path text;
create function public.map_help(request_id uuid,latitude double precision default null,longitude double precision default null,accuracy double precision default null,recorded_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();actor uuid;name text;result public.chat_messages%rowtype;body text;path text;begin
 select id,display_name into actor,name from public.profiles where auth_user_id=(select auth.uid()) and family_id=fam;
 if request_id is null then raise exception 'Begärans ID saknas.';end if;
 perform pg_advisory_xact_lock(hashtextextended('map-help:'||actor,0));
 select * into result from public.chat_messages where family_id=fam and sender_id=actor and client_request_id=request_id;
 if found then return result.id;end if;
 if exists(select 1 from public.chat_messages where family_id=fam and sender_id=actor and kind='help' and created_at>now()-interval '1 minute') then raise exception 'Ett hjälpmeddelande har redan skickats. Vänta en minut.';end if;
 if latitude is null and longitude is null and accuracy is null and recorded_at is null then
  body:='Jag behöver hjälp. Ingen GPS-position är tillgänglig.';path:='/karta';
 else
  if latitude is null or longitude is null or accuracy is null or recorded_at is null or latitude not between -90 and 90 or longitude not between -180 and 180 or accuracy not between 0 and 1000000 or recorded_at>now()+interval '30 seconds' then raise exception 'Ogiltig hjälpposition.';end if;
  path:='/karta?lat='||latitude||'&lng='||longitude||'&at='||extract(epoch from recorded_at)::bigint||'&person='||actor;
  body:='Jag behöver hjälp. Senaste GPS-position: '||latitude||', '||longitude||'. Registrerad '||to_char(recorded_at at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS')||' (Stockholmstid). Noggrannhet ±'||round(accuracy)::text||' m.';
  if recorded_at<now()-interval '2 minutes' then body:=body||' OBS: positionen är äldre än två minuter.';end if;
 end if;
 -- Existing chat_send serializes family ordering and creates the trusted recipient jobs.
 result:=public.chat_send(body,request_id);
 update public.chat_messages set kind='help',map_path=path where id=result.id;
 -- Coordinates stay in authenticated chat, never on a phone's notification lock screen.
 update private.push_jobs set kind='help',payload=payload||jsonb_build_object('title','Hjälp från '||name,'body','Öppna Familjen för hjälpmeddelandet och senaste rapporterade position.','path',path)
 where family_id=fam and object_id=result.id and kind='chat';
 return result.id;
end;$$;
create function public.map_help_status(message_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();begin
 if not exists(select 1 from public.chat_messages where id=message_id and family_id=fam and kind='help' and deleted_at is null) then raise exception 'Hjälpmeddelandet finns inte.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'devices',(select count(*) from public.push_subscriptions s join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id where s.profile_id=p.id and s.active),
 'sent',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status='sent'),
 'failed',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status='failed'),
 'pending',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status in ('pending','sending')),'canceled',j.canceled)),'[]')
 from private.push_jobs j join public.profiles p on p.id=j.recipient_id where j.object_id=message_id and j.family_id=fam and j.kind='help');
end;$$;
create function private.cancel_help_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='help' and new.deleted_at is not null then update private.push_jobs set canceled=true where family_id=new.family_id and object_id=new.id and kind='help';end if;
 return new;
end;$$;
revoke all on function private.cancel_help_push() from public,anon,authenticated;
create trigger cancel_help_push after update on public.chat_messages for each row execute function private.cancel_help_push();
revoke all on function public.map_snapshot(),public.map_report(double precision,double precision,double precision,timestamptz),public.map_help(uuid,double precision,double precision,double precision,timestamptz),public.map_help_status(uuid) from public,anon,authenticated;
grant execute on function public.map_snapshot(),public.map_report(double precision,double precision,double precision,timestamptz),public.map_help(uuid,double precision,double precision,double precision,timestamptz),public.map_help_status(uuid) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='positions') then alter publication supabase_realtime add table public.positions;end if;
end;$$;
create or replace function public.push_claim(batch_limit integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb;
begin
 insert into private.push_deliveries(job_id,subscription_id)
 select j.id,s.id from private.push_jobs j join public.push_subscriptions s on s.profile_id=j.recipient_id and s.family_id=j.family_id and s.active
 join public.profiles p on p.id=s.profile_id join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id
 where not j.canceled and j.due_at<=now() and j.expires_at>now() on conflict do nothing;
 with candidates as (
 select d.id from private.push_deliveries d join private.push_jobs j on j.id=d.job_id join public.push_subscriptions s on s.id=d.subscription_id join public.profiles p on p.id=s.profile_id join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id
 where not j.canceled and j.expires_at>now() and s.active and s.profile_id=j.recipient_id and s.family_id=j.family_id and d.attempts<6 and d.next_at<=now()
 and (d.status='pending' or (d.status='sending' and d.lease_until<now())) order by (j.kind='help') desc,d.next_at limit least(greatest(batch_limit,1),50) for update of d skip locked
 ), leased as(update private.push_deliveries d set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() from candidates c where d.id=c.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'lease',d.lease_token,'job',j.id,'subscription',s.subscription,'payload',j.payload||jsonb_build_object('id',j.id,'kind',j.kind),'expires',j.expires_at)),'[]') into output from leased d join private.push_jobs j on j.id=d.job_id join public.push_subscriptions s on s.id=d.subscription_id;
 return output;
end;$$;
notify pgrst,'reload schema';
commit;
