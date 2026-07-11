-- ============================================================
-- Migración: rate limit distribuido entre instancias de Vercel (SEC-01, parcial)
--
-- Contexto: src/lib/rate-limit.ts usaba un Map en memoria por proceso — en producción, con más
-- de una instancia serverless activa a la vez, cada una tiene su propio contador, así que el
-- límite real termina siendo maxRequests * (instancias activas), no maxRequests. check_rate_limit
-- mueve el contador a Postgres (ventana fija, UPSERT atómico) para que todas las instancias
-- compartan el mismo estado. Usado hoy por /api/public/lead y /api/public/click (anti-spam).
-- ============================================================

create table if not exists rate_limit_counters (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 1,
  updated_at timestamptz not null default now()
);

create or replace function check_rate_limit(p_key text, p_window_ms bigint, p_max integer)
returns table(allowed boolean, remaining integer) as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
begin
  insert into rate_limit_counters as rlc (key, window_start, count, updated_at)
  values (p_key, v_now, 1, v_now)
  on conflict (key) do update set
    window_start = case
      when rlc.window_start <= v_now - (p_window_ms::text || ' milliseconds')::interval then v_now
      else rlc.window_start
    end,
    count = case
      when rlc.window_start <= v_now - (p_window_ms::text || ' milliseconds')::interval then 1
      else rlc.count + 1
    end,
    updated_at = v_now
  returning rlc.window_start, rlc.count into v_window_start, v_count;

  return query select (v_count <= p_max), greatest(p_max - v_count, 0);
end;
$$ language plpgsql;

alter table rate_limit_counters enable row level security;

create policy "service_role_all_rate_limit_counters"
  on rate_limit_counters for all to service_role using (true) with check (true);
