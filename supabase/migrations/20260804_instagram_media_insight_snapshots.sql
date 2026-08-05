-- Historial por pieza de los insights nativos de Instagram.
--
-- La pieza sigue conservando el último dato en app_config.content_pipeline para compatibilidad,
-- pero esta tabla permite comparar una misma publicación cerca de 24 h, 72 h y 7 días.
-- Una reejecución del mantenimiento en el mismo día argentino actualiza la misma fila.

create table if not exists instagram_media_insight_snapshots (
  id uuid default uuid_generate_v4() primary key,
  item_id text not null,
  instagram_media_id text not null,
  published_at timestamptz not null,
  captured_at timestamptz not null,
  capture_date date not null,
  hours_since_publish int not null check (hours_since_publish >= 0),
  reach bigint,
  views bigint,
  likes bigint,
  comments bigint,
  saved bigint,
  shares bigint,
  follows bigint,
  profile_visits bigint,
  total_watch_time_ms bigint,
  average_watch_time_ms bigint,
  reels_skip_rate numeric,
  raw_metrics_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists instagram_media_insight_snapshots_media_day_idx
  on instagram_media_insight_snapshots(instagram_media_id, capture_date);

create index if not exists instagram_media_insight_snapshots_item_time_idx
  on instagram_media_insight_snapshots(item_id, captured_at desc);

alter table instagram_media_insight_snapshots enable row level security;

create policy "service_role_write_instagram_media_insight_snapshots"
  on instagram_media_insight_snapshots for all to service_role using (true) with check (true);

create policy "authenticated_read_instagram_media_insight_snapshots"
  on instagram_media_insight_snapshots for select to authenticated using (true);

-- Las publicaciones nuevas reciben la hora exacta desde content-publish.ts. Para piezas históricas,
-- fijamos una sola vez la mejor evidencia disponible: la marca manual y, en su defecto, updated_at.
-- Es una aproximación documentada y evita que futuras ediciones sigan desplazando la referencia.
with transformed as (
  select coalesce(jsonb_agg(
    case
      when item->>'status' = 'published'
        and coalesce(item->>'published_at', '') = ''
        and coalesce(item#>>'{manual_publish_note,marked_at}', item->>'updated_at') is not null
      then jsonb_set(
        item,
        '{published_at}',
        to_jsonb(coalesce(item#>>'{manual_publish_note,marked_at}', item->>'updated_at')),
        true
      )
      else item
    end
    order by ordinal
  ), '[]'::jsonb) as value
  from app_config as config
  cross join lateral jsonb_array_elements(config.value) with ordinality as entries(item, ordinal)
  where config.key = 'content_pipeline'
    and jsonb_typeof(config.value) = 'array'
)
update app_config
set value = transformed.value
from transformed
where app_config.key = 'content_pipeline';
