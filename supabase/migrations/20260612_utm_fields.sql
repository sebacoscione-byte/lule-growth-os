-- Add UTM tracking + click tracking fields to leads table
-- These fields capture where each visitor comes from and how they interacted with the landing

alter table leads
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists origin_url text,
  add column if not exists landing_page text,
  add column if not exists clicked_cimel_cta boolean not null default false,
  add column if not exists clicked_swiss_cta boolean not null default false,
  add column if not exists booking_instruction_viewed boolean not null default false;

create index if not exists leads_utm_source_idx on leads(utm_source);
create index if not exists leads_landing_page_idx on leads(landing_page);

-- Add additional checklist items for Instagram bio and cardiología category
insert into google_local_checklist (item_key) values
  ('categoria_cardiologia'),
  ('link_instagram_bio'),
  ('posts_fijados_3')
on conflict (item_key) do nothing;
