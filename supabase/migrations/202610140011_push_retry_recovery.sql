begin;
-- A title/description edit can cancel a pending occurrence without changing its
-- idempotency key. Refresh that same job if no device has acknowledged it yet.
create or replace function private.push_add(f uuid,recipient uuid,k text,kind text,obj uuid,title text,body text,path text,due timestamptz default now(),expiry timestamptz default now()+interval '1 hour') returns void language sql security definer set search_path='' as $$
 insert into private.push_jobs as j(family_id,recipient_id,dedupe_key,kind,object_id,payload,due_at,expires_at)
 select f,recipient,k,kind,obj,jsonb_build_object('title',left(title,160),'body',left(body,350),'path',path,'recipient',recipient),due,expiry
 where exists(select 1 from public.profiles where id=recipient and family_id=f and auth_user_id is not null)
 on conflict(recipient_id,dedupe_key) do update set canceled=false,payload=excluded.payload,due_at=excluded.due_at,expires_at=excluded.expires_at
 where j.canceled and not exists(select 1 from private.push_deliveries d where d.job_id=j.id and d.status='sent');
$$;
-- Keep terminal leases and expired jobs observable as failed, not "sending".
create function public.push_expire_leases() returns void language sql security definer set search_path='' as $$
 update private.push_deliveries d set status='failed',lease_until=null where d.status in ('pending','sending') and (
 (d.attempts>=6 and coalesce(d.lease_until,now())<=now()) or exists(select 1 from private.push_jobs j where j.id=d.job_id and (j.canceled or j.expires_at<=now())));
$$;
revoke all on function public.push_expire_leases() from public,anon,authenticated;
grant execute on function public.push_expire_leases() to service_role;
commit;
