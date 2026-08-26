-- Al Maher customer wallet ledger
-- Additive only: no existing booking/payment rows are rewritten.
-- Balance is always derived from posted ledger entries; never persist a mutable balance.

create table if not exists public.customer_wallets (
  id uuid primary key default gen_random_uuid(),
  customer_identity text not null,
  customer_phone text,
  customer_name text,
  data_environment text not null default 'training',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_wallets_environment_check check (data_environment in ('training','production'))
);

create unique index if not exists customer_wallets_identity_environment_uq
  on public.customer_wallets (customer_identity, data_environment);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.customer_wallets(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  transaction_type text not null,
  amount numeric not null,
  status text not null default 'posted',
  reason text not null,
  reference_no text,
  idempotency_key text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  data_environment text not null default 'training',
  created_at timestamptz not null default now(),
  constraint wallet_transactions_type_check check (transaction_type in ('credit','debit','adjustment')),
  constraint wallet_transactions_amount_check check (amount > 0),
  constraint wallet_transactions_status_check check (status in ('pending','posted','reversed')),
  constraint wallet_transactions_environment_check check (data_environment in ('training','production'))
);

create unique index if not exists wallet_transactions_idempotency_uq
  on public.wallet_transactions (idempotency_key)
  where idempotency_key is not null;

create index if not exists wallet_transactions_wallet_created_idx
  on public.wallet_transactions (wallet_id, created_at desc);
create index if not exists wallet_transactions_booking_idx
  on public.wallet_transactions (booking_id);

create or replace view public.v_customer_wallet_balances
with (security_invoker=true)
as
select
  w.id as wallet_id,
  w.customer_identity,
  w.customer_phone,
  w.customer_name,
  w.data_environment,
  coalesce(sum(
    case
      when t.status <> 'posted' then 0
      when t.transaction_type = 'credit' then t.amount
      when t.transaction_type = 'debit' then -t.amount
      else t.amount
    end
  ),0)::numeric as balance,
  max(t.created_at) as last_transaction_at
from public.customer_wallets w
left join public.wallet_transactions t on t.wallet_id=w.id
  and t.data_environment=w.data_environment
group by w.id,w.customer_identity,w.customer_phone,w.customer_name,w.data_environment;

alter table public.customer_wallets enable row level security;
alter table public.wallet_transactions enable row level security;

comment on table public.customer_wallets is 'Customer wallet account identity record. Balance is derived from wallet_transactions.';
comment on table public.wallet_transactions is 'Immutable-style customer wallet ledger. Never overwrite balance directly.';
