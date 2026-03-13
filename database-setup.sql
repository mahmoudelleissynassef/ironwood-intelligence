-- =============================================
-- IRONWOOD INTELLIGENCE DATABASE
-- =============================================

-- 1. PROPERTIES TABLE
-- Each row = one property listing
create table properties (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),

  -- Identity
  property_name text,
  asset_class text check (asset_class in ('Office', 'Retail', 'Residential', 'Industrial', 'Hospitality', 'Land')),
  listing_type text check (listing_type in ('For Sale', 'For Rent', 'Both')),

  -- Location
  country text not null,
  city text not null,
  submarket text,

  -- Size
  size_sqm numeric,

  -- Source
  source_url text,
  source_name text,

  -- Status
  is_active boolean default true
);

-- 2. PRICE RECORDS TABLE
-- Each row = one price entry for a property at a point in time
-- This powers your charts and historical tracking
create table price_records (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),

  property_id uuid references properties(id) on delete cascade,

  -- Pricing
  asking_rent_sqm numeric,        -- rent per sqm per year
  sale_price numeric,             -- total sale price
  sale_price_sqm numeric,         -- sale price per sqm

  -- Time period
  date_recorded date not null,
  quarter text,                   -- e.g. 'Q1 2025'
  year integer,

  -- Currency
  currency text default 'USD',

  notes text
);

-- 3. MARKET AVERAGES TABLE
-- Each row = average metrics for a city + asset class + quarter
-- This powers the analytics dashboard charts
create table market_averages (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),

  country text not null,
  city text not null,
  submarket text,
  asset_class text check (asset_class in ('Office', 'Retail', 'Residential', 'Industrial', 'Hospitality', 'Land')),

  quarter text not null,          -- e.g. 'Q1 2025'
  year integer not null,

  avg_rent_sqm numeric,
  avg_sale_price_sqm numeric,
  vacancy_rate numeric,           -- percentage e.g. 10.5
  total_listings integer,

  currency text default 'USD'
);

-- 4. PROFILES TABLE
-- Stores user subscription status
create table profiles (
  id uuid references auth.users(id) primary key,
  created_at timestamp with time zone default now(),
  full_name text,
  email text,
  subscription_plan text check (subscription_plan in ('free', 'basic', 'professional', 'enterprise')) default 'free',
  subscription_status text check (subscription_status in ('active', 'inactive', 'trial')) default 'trial',
  trial_ends_at timestamp with time zone default (now() + interval '7 days')
);

-- =============================================
-- SECURITY: Row Level Security
-- =============================================

alter table properties enable row level security;
alter table price_records enable row level security;
alter table market_averages enable row level security;
alter table profiles enable row level security;

-- Anyone can view properties and market data (teaser)
create policy "Public can view properties" on properties for select using (true);
create policy "Public can view market averages" on market_averages for select using (true);

-- Only logged in users can view price records
create policy "Authenticated users can view price records" on price_records
  for select using (auth.role() = 'authenticated');

-- Users can only view their own profile
create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

-- Auto-create profile when user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
