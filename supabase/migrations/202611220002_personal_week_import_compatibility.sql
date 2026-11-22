-- ChatGPT weekly tasks can include economy. Day categories and access stay scoped.
begin;
alter table public.personal_week_tasks drop constraint personal_week_tasks_category_check;
alter table public.personal_week_tasks add constraint personal_week_tasks_category_check
 check(category in ('work','training','meal','home','family','social','other','selfCare','recovery','economy'));
notify pgrst,'reload schema';
commit;
