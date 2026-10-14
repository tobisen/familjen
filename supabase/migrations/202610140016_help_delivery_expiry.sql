begin;
-- An expired job without a delivery must not remain displayed as queued.
create or replace function public.map_help_status(message_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare fam uuid:=public.require_calendar_family();begin
 if not exists(select 1 from public.chat_messages where id=message_id and family_id=fam and kind='help' and deleted_at is null) then raise exception 'Hjälpmeddelandet finns inte.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'devices',(select count(*) from public.push_subscriptions s join auth.sessions a on a.id=s.session_id and a.user_id=p.auth_user_id where s.profile_id=p.id and s.active),
 'sent',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status='sent'),
 'failed',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status='failed'),
 'pending',(select count(*) from private.push_deliveries d where d.job_id=j.id and d.status in ('pending','sending')),'canceled',j.canceled,'expired',j.expires_at<=now())),'[]')
 from private.push_jobs j join public.profiles p on p.id=j.recipient_id where j.object_id=message_id and j.family_id=fam and j.kind='help');
end;$$;
notify pgrst,'reload schema';
commit;
