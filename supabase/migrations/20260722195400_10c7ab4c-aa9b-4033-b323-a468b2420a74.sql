
-- =====================================================================
-- ROLES ENUM (per-tenant)
-- =====================================================================
create type public.app_role as enum ('owner', 'staff');

-- =====================================================================
-- BARBERSHOPS
-- =====================================================================
create table public.barbershops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.barbershops to authenticated;
grant all on public.barbershops to service_role;

alter table public.barbershops enable row level security;

-- =====================================================================
-- MEMBERSHIP (per-tenant role)
-- =====================================================================
create table public.barbershop_members (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (barbershop_id, user_id)
);

grant select, insert, update, delete on public.barbershop_members to authenticated;
grant all on public.barbershop_members to service_role;

alter table public.barbershop_members enable row level security;

-- =====================================================================
-- SECURITY DEFINER HELPERS (avoid RLS recursion)
-- =====================================================================
create or replace function public.is_barbershop_member(_barbershop_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.barbershop_members
    where barbershop_id = _barbershop_id and user_id = _user_id
  )
$$;

create or replace function public.has_barbershop_role(_barbershop_id uuid, _user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.barbershop_members
    where barbershop_id = _barbershop_id
      and user_id = _user_id
      and role = _role
  )
$$;

-- =====================================================================
-- POLICIES: barbershops
-- =====================================================================
create policy "members can view their barbershops"
  on public.barbershops for select to authenticated
  using (public.is_barbershop_member(id, auth.uid()));

create policy "authenticated users can create a barbershop"
  on public.barbershops for insert to authenticated
  with check (created_by = auth.uid());

create policy "owners can update their barbershop"
  on public.barbershops for update to authenticated
  using (public.has_barbershop_role(id, auth.uid(), 'owner'))
  with check (public.has_barbershop_role(id, auth.uid(), 'owner'));

create policy "owners can delete their barbershop"
  on public.barbershops for delete to authenticated
  using (public.has_barbershop_role(id, auth.uid(), 'owner'));

-- Auto-create owner membership when a barbershop is created
create or replace function public.handle_new_barbershop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.barbershop_members (barbershop_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_barbershop_created
  after insert on public.barbershops
  for each row execute function public.handle_new_barbershop();

-- =====================================================================
-- POLICIES: barbershop_members
-- =====================================================================
create policy "members can view membership of their barbershops"
  on public.barbershop_members for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "owners can add members"
  on public.barbershop_members for insert to authenticated
  with check (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

create policy "owners can update members"
  on public.barbershop_members for update to authenticated
  using (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'))
  with check (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

create policy "owners can remove members"
  on public.barbershop_members for delete to authenticated
  using (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

-- =====================================================================
-- SHARED updated_at TRIGGER
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger barbershops_set_updated_at
  before update on public.barbershops
  for each row execute function public.set_updated_at();

-- =====================================================================
-- CUSTOMERS
-- =====================================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  phone text not null,
  email text,
  status text not null default 'active', -- active | inactive | churned | trial
  tags text[] not null default '{}',
  notes text,
  subscription_started_at date,
  subscription_price_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_barbershop_idx on public.customers(barbershop_id);
create index customers_phone_idx on public.customers(barbershop_id, phone);
create index customers_status_idx on public.customers(barbershop_id, status);

grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;

alter table public.customers enable row level security;

create policy "members can view customers"
  on public.customers for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert customers"
  on public.customers for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can update customers"
  on public.customers for update to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()))
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can delete customers"
  on public.customers for delete to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- =====================================================================
-- MESSAGE TEMPLATES
-- =====================================================================
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  body text not null,
  category text, -- billing | reactivation | loyalty | custom
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index message_templates_barbershop_idx on public.message_templates(barbershop_id);

grant select, insert, update, delete on public.message_templates to authenticated;
grant all on public.message_templates to service_role;

alter table public.message_templates enable row level security;

create policy "members can view templates"
  on public.message_templates for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert templates"
  on public.message_templates for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can update templates"
  on public.message_templates for update to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()))
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can delete templates"
  on public.message_templates for delete to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- =====================================================================
-- CAMPAIGNS
-- =====================================================================
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  template_id uuid references public.message_templates(id) on delete set null,
  status text not null default 'draft', -- draft | scheduled | running | paused | completed | canceled
  audience_filter jsonb not null default '{}'::jsonb,
  pace_seconds integer not null default 30, -- min spacing between messages
  scheduled_for timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_barbershop_idx on public.campaigns(barbershop_id);
create index campaigns_status_idx on public.campaigns(barbershop_id, status);

grant select, insert, update, delete on public.campaigns to authenticated;
grant all on public.campaigns to service_role;

alter table public.campaigns enable row level security;

create policy "members can view campaigns"
  on public.campaigns for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert campaigns"
  on public.campaigns for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()) and created_by = auth.uid());

create policy "members can update campaigns"
  on public.campaigns for update to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()))
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can delete campaigns"
  on public.campaigns for delete to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- =====================================================================
-- CAMPAIGN TARGETS
-- =====================================================================
create table public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'pending', -- pending | queued | sent | failed | skipped
  unique (campaign_id, customer_id)
);

create index campaign_targets_campaign_idx on public.campaign_targets(campaign_id);
create index campaign_targets_barbershop_idx on public.campaign_targets(barbershop_id);

grant select, insert, update, delete on public.campaign_targets to authenticated;
grant all on public.campaign_targets to service_role;

alter table public.campaign_targets enable row level security;

create policy "members can view targets"
  on public.campaign_targets for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert targets"
  on public.campaign_targets for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can update targets"
  on public.campaign_targets for update to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()))
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can delete targets"
  on public.campaign_targets for delete to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

-- =====================================================================
-- MESSAGE JOBS (queue consumed by the Chrome extension)
-- =====================================================================
create table public.message_jobs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  phone text not null,
  rendered_body text not null,
  status text not null default 'pending', -- pending | in_flight | sent | failed | skipped | expired
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_for timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by_token uuid,      -- extension_tokens.id that leased the job
  expires_at timestamptz,     -- lease expiration; expired -> back to pending
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index message_jobs_ready_idx on public.message_jobs(barbershop_id, status, scheduled_for);
create index message_jobs_campaign_idx on public.message_jobs(campaign_id);

grant select, insert, update, delete on public.message_jobs to authenticated;
grant all on public.message_jobs to service_role;

alter table public.message_jobs enable row level security;

create policy "members can view jobs"
  on public.message_jobs for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert jobs"
  on public.message_jobs for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can update jobs"
  on public.message_jobs for update to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()))
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can delete jobs"
  on public.message_jobs for delete to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create trigger message_jobs_set_updated_at
  before update on public.message_jobs
  for each row execute function public.set_updated_at();

-- =====================================================================
-- EXTENSION TOKENS
-- Only the SHA-256 hash of the token is stored. Raw token is shown once
-- at creation and never persisted.
-- Tokens are scoped to a single barbershop and revocable.
-- =====================================================================
create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz,          -- null = no fixed expiration (still revocable)
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index extension_tokens_barbershop_idx on public.extension_tokens(barbershop_id);

grant select, insert, update, delete on public.extension_tokens to authenticated;
grant all on public.extension_tokens to service_role;

alter table public.extension_tokens enable row level security;

-- Only owners can see/manage extension tokens (secret material)
create policy "owners can view tokens"
  on public.extension_tokens for select to authenticated
  using (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

create policy "owners can create tokens"
  on public.extension_tokens for insert to authenticated
  with check (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner') and created_by = auth.uid());

create policy "owners can update tokens"
  on public.extension_tokens for update to authenticated
  using (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'))
  with check (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

create policy "owners can delete tokens"
  on public.extension_tokens for delete to authenticated
  using (public.has_barbershop_role(barbershop_id, auth.uid(), 'owner'));

-- =====================================================================
-- HEALTH EVENTS reported by the extension
-- =====================================================================
create table public.health_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  kind text not null, -- session_lost | dom_selector_broken | rate_limited | other
  severity text not null default 'warning', -- info | warning | critical
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index health_events_barbershop_idx on public.health_events(barbershop_id, created_at desc);

grant select, insert, update, delete on public.health_events to authenticated;
grant all on public.health_events to service_role;

alter table public.health_events enable row level security;

create policy "members can view health events"
  on public.health_events for select to authenticated
  using (public.is_barbershop_member(barbershop_id, auth.uid()));

create policy "members can insert health events"
  on public.health_events for insert to authenticated
  with check (public.is_barbershop_member(barbershop_id, auth.uid()));
