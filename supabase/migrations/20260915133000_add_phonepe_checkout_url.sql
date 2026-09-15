alter table public.hpc_payments
  add column if not exists checkout_url text;

create index if not exists hpc_payments_provider_order_idx
  on public.hpc_payments (provider_order_id);
