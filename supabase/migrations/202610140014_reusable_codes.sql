begin;
alter table private.device_registration_codes add column revoked_at timestamptz;
-- Only the latest issued code per profile becomes reusable. Superseded codes stay revoked.
with ranked as (select id,row_number() over(partition by profile_id order by created_at desc,id desc) as rank from private.device_registration_codes)
update private.device_registration_codes c set revoked_at=case when ranked.rank>1 then now() end,expires_at='infinity'::timestamptz from ranked where ranked.id=c.id;
create or replace function public.redeem_device_registration(code_hash text,selected_profile text,client_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation private.device_registration_codes%rowtype; target public.profiles%rowtype; attempt_id bigint;
begin
 if selected_profile not in ('tobias','neo','sally') or code_hash !~ '^[0-9a-f]{64}$' or client_ip_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','invalid'); end if;
 -- Serialize profile then IP; profile cap also applies when spoofed headers/IP rotation defeat the IP cap.
 perform pg_advisory_xact_lock(hashtextextended('registration-profile:'||selected_profile,0));
 perform pg_advisory_xact_lock(hashtextextended('registration-ip:'||client_ip_hash,0));
 delete from private.device_registration_attempts where attempted_at<now()-interval '1 day';
 if (select count(*) from private.device_registration_attempts where profile_key=selected_profile and attempted_at>now()-interval '15 minutes' and not succeeded)>=10
 or (select count(*) from private.device_registration_attempts where ip_hash=client_ip_hash and attempted_at>now()-interval '15 minutes' and not succeeded)>=20 then
  return jsonb_build_object('status','limited');
 end if;
 insert into private.device_registration_attempts(profile_key,ip_hash) values(selected_profile,client_ip_hash) returning id into attempt_id;
 select * into invitation from private.device_registration_codes c where c.code_hash=redeem_device_registration.code_hash for update;
 if not found or invitation.revoked_at is not null or invitation.expires_at<=now() then return jsonb_build_object('status','invalid'); end if;
 select * into target from public.profiles where id=invitation.profile_id and profile_key=selected_profile and auth_user_id is not null;
 if not found then return jsonb_build_object('status','invalid'); end if;
 update private.device_registration_codes set used_at=now() where id=invitation.id;
 update private.device_registration_attempts set succeeded=true where id=attempt_id;
 -- Never return this to the browser. Edge exchanges it for the already bound Supabase Auth user.
 return jsonb_build_object('status','accepted','user_id',target.auth_user_id,'registration_id',invitation.id);
end;$$;
notify pgrst,'reload schema';
commit;
