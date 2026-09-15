create sequence if not exists public.hpc_registration_seq start 1 increment 1;

create table if not exists public.hpc_registrations (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique default ('HPC27-' || lpad(nextval('public.hpc_registration_seq')::text, 6, '0')),
  full_name text not null,
  email text not null,
  mobile text not null,
  institution text not null,
  city text not null,
  participant_type text not null,
  track text not null check (track in ('showcase','challenge','workshops')),
  workshop_option text check (workshop_option in ('gpu_cuda','genai_llm','both')),
  challenge_team_name text,
  amount integer not null default 0 check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  registration_status text not null default 'PENDING_PAYMENT' check (registration_status in ('PENDING_PAYMENT','PAYMENT_PROCESSING','CONFIRMED','PAYMENT_FAILED','CANCELLED')),
  payment_status text not null default 'NOT_REQUIRED' check (payment_status in ('NOT_REQUIRED','PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hpc_workshop_selection_valid check (
    (track = 'workshops' and workshop_option is not null) or
    (track <> 'workshops' and workshop_option is null)
  ),
  constraint hpc_workshop_amount_valid check (
    (track = 'workshops' and ((workshop_option in ('gpu_cuda','genai_llm') and amount = 300) or (workshop_option = 'both' and amount = 500))) or
    (track <> 'workshops' and amount = 0)
  ),
  constraint hpc_challenge_team_valid check (
    (track = 'challenge' and challenge_team_name is not null and length(trim(challenge_team_name)) >= 2) or
    (track <> 'challenge' and challenge_team_name is null)
  )
);

create table if not exists public.hpc_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.hpc_registrations(id) on delete cascade,
  provider text not null default 'phonepe' check (provider = 'phonepe'),
  provider_order_id text unique,
  provider_transaction_id text,
  amount integer not null check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED')),
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hpc_payment_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid references public.hpc_registrations(id) on delete set null,
  provider text not null default 'phonepe' check (provider = 'phonepe'),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists hpc_registrations_email_idx on public.hpc_registrations (lower(email));
create index if not exists hpc_registrations_track_idx on public.hpc_registrations (track);
create index if not exists hpc_registrations_created_at_idx on public.hpc_registrations (created_at desc);
create index if not exists hpc_payments_registration_idx on public.hpc_payments (registration_id);
create index if not exists hpc_payment_events_registration_idx on public.hpc_payment_events (registration_id);

alter table public.hpc_registrations enable row level security;
alter table public.hpc_payments enable row level security;
alter table public.hpc_payment_events enable row level security;

create or replace function public.hpc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hpc_registrations_touch_updated_at on public.hpc_registrations;
create trigger hpc_registrations_touch_updated_at before update on public.hpc_registrations for each row execute function public.hpc_touch_updated_at();

drop trigger if exists hpc_payments_touch_updated_at on public.hpc_payments;
create trigger hpc_payments_touch_updated_at before update on public.hpc_payments for each row execute function public.hpc_touch_updated_at();
