-- Add missing columns to properties table to match scraped data
alter table properties 
  add column if not exists title text,
  add column if not exists price numeric,
  add column if not exists price_per_sqm numeric,
  add column if not exists unit text,
  add column if not exists bedrooms integer,
  add column if not exists bathrooms integer,
  add column if not exists details text,
  add column if not exists image_url text,
  add column if not exists images_joined text,
  add column if not exists retrieved_at date,
  add column if not exists document_name text;
