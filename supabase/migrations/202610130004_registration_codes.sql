-- High-entropy personal registration codes. No anonymous table/RPC access.
begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.device_registration_codes (
 id uuid primary key default gen_random_uuid(), code_hash text unique not null check(code_hash ~ '^[0-9a-f]{64}$'),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now(),
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create table private.device_registration_attempts (
 id bigint generated always as identity primary key, profile_key text not null, ip_hash text not null,
 attempted_at timestamptz not null default now(), succeeded boolean not null default false
);
create index on private.device_registration_attempts(profile_key,attempted_at);
create index on private.device_registration_attempts(ip_hash,attempted_at);
alter table private.device_registration_codes enable row level security;
alter table private.device_registration_attempts enable row level security;
revoke all on private.device_registration_codes,private.device_registration_attempts from public,anon,authenticated;
-- Service only. Both admission limits and consuming a code are atomic.
create function public.redeem_device_registration(code_hash text,selected_profile text,client_ip_hash text) returns jsonb
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
 if not found or invitation.used_at is not null or invitation.expires_at<=now() then return jsonb_build_object('status','invalid'); end if;
 select * into target from public.profiles where id=invitation.profile_id and profile_key=selected_profile and auth_user_id is not null;
 if not found then return jsonb_build_object('status','invalid'); end if;
 update private.device_registration_codes set used_at=now() where id=invitation.id;
 update private.device_registration_attempts set succeeded=true where id=attempt_id;
 -- Never return this to the browser. Edge exchanges it for the already bound Supabase Auth user.
 return jsonb_build_object('status','accepted','user_id',target.auth_user_id,'registration_id',invitation.id);
end;$$;
revoke all on function public.redeem_device_registration(text,text,text) from public,anon,authenticated;
grant execute on function public.redeem_device_registration(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
