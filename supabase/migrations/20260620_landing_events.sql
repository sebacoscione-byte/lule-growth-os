-- Landing events: clicks anonimos en CTAs de landings publicas

create table if not exists landing_events (
  id uuid default uuid_generate_v4() primary key,
  event_type text not null
    check (event_type in ('cta_cimel', 'cta_swiss', 'instructions_viewed', 'form_started', 'form_submitted')),
  slug text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create index if not exists landing_events_slug_idx on landing_events(slug);
create index if not exists landing_events_event_type_idx on landing_events(event_type);
create index if not exists landing_events_created_at_idx on landing_events(created_at desc);

alter table landing_events enable row level security;

create policy "service_role_write_landing_events"
  on landing_events for all to service_role using (true) with check (true);

create policy "authenticated_read_landing_events"
  on landing_events for select to authenticated using (true);
