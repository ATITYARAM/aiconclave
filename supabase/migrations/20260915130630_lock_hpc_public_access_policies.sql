alter function public.hpc_touch_updated_at() set search_path = public;

create policy hpc_registrations_deny_anon on public.hpc_registrations for all to anon using (false) with check (false);
create policy hpc_payments_deny_anon on public.hpc_payments for all to anon using (false) with check (false);
create policy hpc_payment_events_deny_anon on public.hpc_payment_events for all to anon using (false) with check (false);
