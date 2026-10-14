begin;
-- Keep coordinates out of browser URL history, push payloads and public links.
alter table public.chat_messages add column help_position jsonb;
do $$declare m record; parts text[];begin
 for m in select id,map_path from public.chat_messages where kind='help' and deleted_at is null loop
  parts:=regexp_match(m.map_path,'^/karta\?lat=([^&]+)&lng=([^&]+)&at=([^&]+)&person=');
  if parts is not null then
   begin
    update public.chat_messages set help_position=jsonb_build_object('latitude',parts[1]::double precision,'longitude',parts[2]::double precision,'accuracy',null,'timestamp',parts[3]::double precision*1000) where id=m.id;
   exception when invalid_text_representation or numeric_value_out_of_range then null;
   end;
  end if;
  update public.chat_messages set map_path='/karta?help='||id where id=m.id;
 end loop;
end;$$;
update public.chat_messages set map_path=null,help_position=null where deleted_at is not null;
update private.push_jobs j set payload=jsonb_set(j.payload,'{path}',to_jsonb('/karta?help='||j.object_id::text)) where j.kind='help';
create function private.scrub_help_position() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.deleted_at is not null then new.help_position:=null;new.map_path:=null;end if;return new;end;$$;
revoke all on function private.scrub_help_position() from public,anon,authenticated;
create trigger scrub_help_position before update on public.chat_messages for each row execute function private.scrub_help_position();
create or replace function public.map_help(request_id uuid,latitude double precision default null,longitude double precision default null,accuracy double precision default null,recorded_at timestamptz default null) returns uuid
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
  path:='/karta';
  body:='Jag behöver hjälp. Senaste GPS-position: '||latitude||', '||longitude||'. Registrerad '||to_char(recorded_at at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS')||' (Stockholmstid). Noggrannhet ±'||round(accuracy)::text||' m.';
  if recorded_at<now()-interval '2 minutes' then body:=body||' OBS: positionen är äldre än två minuter.';end if;
 end if;
 -- Existing chat_send serializes family ordering and creates the trusted recipient jobs.
 result:=public.chat_send(body,request_id);
 path:='/karta?help='||result.id;
 update public.chat_messages set kind='help',map_path=path,help_position=case when latitude is null then null else jsonb_build_object('latitude',latitude,'longitude',longitude,'accuracy',accuracy,'timestamp',extract(epoch from recorded_at)*1000) end where id=result.id;
 -- Coordinates stay in authenticated chat, never on a phone's notification lock screen.
 update private.push_jobs set kind='help',payload=payload||jsonb_build_object('title','Hjälp från '||name,'body','Öppna Familjen för hjälpmeddelandet och senaste rapporterade position.','path',path)
 where family_id=fam and object_id=result.id and kind='chat';
 return result.id;
end;$$;
create function public.map_help_position(message_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare fam uuid:=public.require_calendar_family();result jsonb;begin
 select jsonb_build_object('position',m.help_position,'name',p.display_name,'created_at',m.created_at) into result from public.chat_messages m join public.profiles p on p.id=m.sender_id and p.family_id=m.family_id where m.id=message_id and m.family_id=fam and m.kind='help' and m.deleted_at is null;
 if result is null then raise exception 'Hjälpmeddelandet finns inte eller har raderats.';end if;
 return result;
end;$$;
revoke all on function public.map_help_position(uuid) from public,anon,authenticated;
grant execute on function public.map_help_position(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
