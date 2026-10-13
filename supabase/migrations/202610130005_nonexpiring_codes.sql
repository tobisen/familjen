-- Personal codes stay single-use and revocable, without a time limit.
begin;
alter table private.device_registration_codes drop constraint device_registration_codes_check;
alter table private.device_registration_codes add constraint device_registration_codes_check check(expires_at>created_at);
update private.device_registration_codes set expires_at='infinity'::timestamptz where used_at is null;
commit;
