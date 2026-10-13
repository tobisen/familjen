-- Phase 0: apply using Supabase SQL Editor or CLI as database owner.
begin;
create table public.families (id uuid primary key default gen_random_uuid(), name text not null);
create table public.profiles (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 auth_user_id uuid unique references auth.users(id) on delete set null, display_name text not null,
 unique (id, family_id)
);
-- Membership provisioning is admin-only. The browser cannot insert/update profiles.
create function public.is_family_member(target_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where family_id = target_family and auth_user_id = (select auth.uid()));
$$;
create function public.is_own_profile(target_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = target_profile and auth_user_id = (select auth.uid()));
$$;
revoke all on function public.is_family_member(uuid), public.is_own_profile(uuid) from public, anon;
grant execute on function public.is_family_member(uuid), public.is_own_profile(uuid) to authenticated;
create table public.calendar_events (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id), title text not null check(length(trim(title)) > 0),
 starts_at timestamptz not null, ends_at timestamptz not null, created_by uuid not null,
 reminder_minutes integer check(reminder_minutes >= 0), unique(id,family_id),
 foreign key(created_by,family_id) references public.profiles(id,family_id), check(ends_at > starts_at)
);
create table public.event_participants (
 event_id uuid not null, profile_id uuid not null, family_id uuid not null,
 primary key(event_id,profile_id), foreign key(event_id,family_id) references public.calendar_events(id,family_id) on delete cascade,
 foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
create table public.school_lessons (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 student_id uuid not null, external_id text not null check(length(trim(external_id)) > 0),
 weekday smallint not null check(weekday between 1 and 7), starts_at time not null, ends_at time not null,
 subject text not null check(length(trim(subject)) > 0), room text, term_start date not null, term_end date not null,
 exception_dates date[] not null default '{}', unique(family_id,student_id,external_id),
 foreign key(student_id,family_id) references public.profiles(id,family_id), check(ends_at > starts_at), check(term_end >= term_start)
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 title text not null check(length(trim(title)) > 0), completed boolean not null default false, assigned_to uuid,
 foreign key(assigned_to,family_id) references public.profiles(id,family_id)
);
create table public.shopping_items (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 title text not null check(length(trim(title)) > 0), quantity text, purchased boolean not null default false
);
create table public.chat_messages (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 sender_id uuid not null, body text not null check(length(trim(body)) between 1 and 10000), created_at timestamptz not null default now(),
 foreign key(sender_id,family_id) references public.profiles(id,family_id)
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 profile_id uuid not null, endpoint text not null unique, subscription jsonb not null,
 foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
create table public.positions (
 profile_id uuid primary key, family_id uuid not null references public.families(id), latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180), accuracy double precision not null check(accuracy >= 0),
 reported_at timestamptz not null default now(), foreign key(profile_id,family_id) references public.profiles(id,family_id)
);
alter table public.families enable row level security;
revoke all on public.families from anon, authenticated;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
create index on public.profiles(family_id);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon, authenticated;
create index on public.calendar_events(family_id);
alter table public.event_participants enable row level security;
revoke all on public.event_participants from anon, authenticated;
create index on public.event_participants(family_id);
alter table public.school_lessons enable row level security;
revoke all on public.school_lessons from anon, authenticated;
create index on public.school_lessons(family_id);
alter table public.tasks enable row level security;
revoke all on public.tasks from anon, authenticated;
create index on public.tasks(family_id);
alter table public.shopping_items enable row level security;
revoke all on public.shopping_items from anon, authenticated;
create index on public.shopping_items(family_id);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;
create index on public.chat_messages(family_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
create index on public.push_subscriptions(family_id);
alter table public.positions enable row level security;
revoke all on public.positions from anon, authenticated;
create index on public.positions(family_id);
grant select on public.families to authenticated;
create policy member_read on public.families for select to authenticated using (public.is_family_member(id));
grant select on public.profiles to authenticated;
create policy member_read on public.profiles for select to authenticated using (public.is_family_member(family_id));
grant select on public.calendar_events to authenticated;
create policy member_read on public.calendar_events for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.calendar_events to authenticated;
create policy member_insert on public.calendar_events for insert to authenticated with check (public.is_family_member(family_id) and public.is_own_profile(created_by));
create policy member_update on public.calendar_events for update to authenticated using (public.is_family_member(family_id) and public.is_own_profile(created_by)) with check (public.is_family_member(family_id) and public.is_own_profile(created_by));
create policy member_delete on public.calendar_events for delete to authenticated using (public.is_family_member(family_id) and public.is_own_profile(created_by)) ;
grant select on public.event_participants to authenticated;
create policy member_read on public.event_participants for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.event_participants to authenticated;
create policy member_insert on public.event_participants for insert to authenticated with check (public.is_family_member(family_id));
create policy member_update on public.event_participants for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy member_delete on public.event_participants for delete to authenticated using (public.is_family_member(family_id)) ;
grant select on public.school_lessons to authenticated;
create policy member_read on public.school_lessons for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.school_lessons to authenticated;
create policy member_insert on public.school_lessons for insert to authenticated with check (public.is_family_member(family_id));
create policy member_update on public.school_lessons for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy member_delete on public.school_lessons for delete to authenticated using (public.is_family_member(family_id)) ;
grant select on public.tasks to authenticated;
create policy member_read on public.tasks for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.tasks to authenticated;
create policy member_insert on public.tasks for insert to authenticated with check (public.is_family_member(family_id));
create policy member_update on public.tasks for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy member_delete on public.tasks for delete to authenticated using (public.is_family_member(family_id)) ;
grant select on public.shopping_items to authenticated;
create policy member_read on public.shopping_items for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.shopping_items to authenticated;
create policy member_insert on public.shopping_items for insert to authenticated with check (public.is_family_member(family_id));
create policy member_update on public.shopping_items for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy member_delete on public.shopping_items for delete to authenticated using (public.is_family_member(family_id)) ;
grant select on public.chat_messages to authenticated;
create policy member_read on public.chat_messages for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.chat_messages to authenticated;
create policy member_insert on public.chat_messages for insert to authenticated with check (public.is_family_member(family_id) and public.is_own_profile(sender_id));
create policy member_update on public.chat_messages for update to authenticated using (public.is_family_member(family_id) and public.is_own_profile(sender_id)) with check (public.is_family_member(family_id) and public.is_own_profile(sender_id));
create policy member_delete on public.chat_messages for delete to authenticated using (public.is_family_member(family_id) and public.is_own_profile(sender_id)) ;
grant select on public.push_subscriptions to authenticated;
create policy member_read on public.push_subscriptions for select to authenticated using (public.is_family_member(family_id) and public.is_own_profile(profile_id));
grant insert, update, delete on public.push_subscriptions to authenticated;
create policy member_insert on public.push_subscriptions for insert to authenticated with check (public.is_family_member(family_id) and public.is_own_profile(profile_id));
create policy member_update on public.push_subscriptions for update to authenticated using (public.is_family_member(family_id) and public.is_own_profile(profile_id)) with check (public.is_family_member(family_id) and public.is_own_profile(profile_id));
create policy member_delete on public.push_subscriptions for delete to authenticated using (public.is_family_member(family_id) and public.is_own_profile(profile_id)) ;
grant select on public.positions to authenticated;
create policy member_read on public.positions for select to authenticated using (public.is_family_member(family_id));
grant insert, update, delete on public.positions to authenticated;
create policy member_insert on public.positions for insert to authenticated with check (public.is_family_member(family_id) and public.is_own_profile(profile_id));
create policy member_update on public.positions for update to authenticated using (public.is_family_member(family_id) and public.is_own_profile(profile_id)) with check (public.is_family_member(family_id) and public.is_own_profile(profile_id));
create policy member_delete on public.positions for delete to authenticated using (public.is_family_member(family_id) and public.is_own_profile(profile_id)) ;
-- Realtime opt-in is deferred to Phase 1; no anonymous access is granted.
commit;
