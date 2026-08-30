-- Identity and scope: who exists, and what they may be scoped to.
--
-- Deliberately NOT the whole of section 4. The answer to q10 in the plan gates the first
-- migration that creates or alters a table carrying business-specific fields, until one
-- branch of each business has been shadowed and a written field list exists. The notebook
-- fields nobody has read yet - a discount amount, an item count - land in `transactions`
-- and `laundry_orders`, so those wait. Nothing a notebook records lands in an organisation,
-- a business, a branch or a membership, so these do not.
--
-- Splitting it this way is what lets auth, the shell and the branch/staff admin start now,
-- which is what that same answer said should happen.

-- ---------------------------------------------------------------- enums

-- Only the two these tables need. The rest arrive with the tables that use them, so a
-- migration file says exactly what it is for.
create type business_type as enum ('laundry', 'spa', 'skincare');
create type member_role as enum ('owner', 'manager', 'staff');

-- ---------------------------------------------------------------- tables

-- Mirrors auth.users. Kept separate because auth.users belongs to Supabase and a foreign
-- key from application tables into a schema we do not own is a dependency we cannot migrate.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  type business_type not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- THE authorization model. One row is one grant.
--
--   owner   - branch_id null, full access to everything in the org
--   manager - branch_id set,  their branch including money
--   staff   - branch_id set,  their branch, no financial reads
--
-- The two check constraints are what stop a grant that means nothing: an owner pinned to one
-- branch, or a manager with no branch at all. Both are cheap here and unfixable later, once
-- rows exist that violate whichever one was missing.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  constraint owner_is_org_wide check (role <> 'owner' or branch_id is null),
  constraint staff_needs_branch check (role = 'owner' or branch_id is not null),
  -- One grant per person per scope. A second row for the same branch is a duplicate, not a
  -- second permission.
  unique (user_id, org_id, branch_id)
);

-- Every RLS policy starts from "which memberships does this user have", so this index is
-- read on effectively every query rather than occasionally.
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_branch_id_idx on public.memberships (branch_id);

-- ---------------------------------------------------------------- profile on signup

-- A profile row for every auth user, created by trigger rather than by the application.
--
-- The owner invites staff server-side with the service role key, and an invite that created
-- the auth user but failed before writing the profile would leave someone who can sign in
-- and belongs to nothing. A trigger cannot be skipped by a caller that forgot.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- Empty search_path: a security definer function runs as its owner, and resolving an
-- unqualified name through a caller-controlled search_path is how those get hijacked.
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    -- The invite carries these in user_metadata. Falling back to the email keeps the not-null
    -- constraint satisfiable rather than failing the signup outright.
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Unnamed'),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ---------------------------------------------------------------- RLS

-- Enabled here, with no policies yet. That is deliberate and it is the safe order: with RLS
-- on and no policy, every row is denied. Section 5's policies arrive with the five-persona
-- suite that proves them, and until then nothing is readable rather than everything.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.businesses enable row level security;
alter table public.branches enable row level security;
alter table public.memberships enable row level security;
