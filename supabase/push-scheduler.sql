-- Apply as database owner after migration 010, worker deploy and Vault setup.
-- Vault entry familjen_push_worker_secret must match Edge PUSH_WORKER_SECRET.
-- No secret is embedded in cron's command or its run logs.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function private.invoke_push_worker() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(
 url:='https://mulsuwdmpixzukzwpocf.supabase.co/functions/v1/push-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-push-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='familjen_push_worker_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=20000);
$$;
revoke all on function private.invoke_push_worker() from public,anon,authenticated;
-- Same named job is replaced rather than duplicated.
select cron.schedule('familjen-push-worker','* * * * *','select private.invoke_push_worker();');
