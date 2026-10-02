-- Supabase Auth "send SMS" hook. With this hook enabled, Supabase Auth treats it as the SMS
-- provider, so phone login works without a Twilio account.
--
-- Demo and local development only: it accepts the request and sends nothing. The synthetic demo numbers sign in
-- with fixed test OTPs (supabase/config.toml [auth.sms.test_otp]), which never reach this hook. Any other number is
-- refused earlier by app.hook_before_user_created unless the hospital provisioned it.
-- It never stores or logs the OTP.
-- Pilot: replace with an HTTP hook to an Edge Function that calls a real SMS provider (e.g. MSG91).

create function app.hook_send_sms(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  return '{}'::jsonb;
end $$;

revoke execute on function app.hook_send_sms(jsonb) from public, anon, authenticated;
grant usage on schema app to supabase_auth_admin;
grant execute on function app.hook_send_sms(jsonb) to supabase_auth_admin;
