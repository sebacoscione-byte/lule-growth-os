-- Ledger durable para los cinco crons de Vercel y sus disparadores de respaldo.
-- La clave tarea+fecha hace que Vercel y Supabase puedan intentar la misma corrida sin duplicarla.

create table if not exists cron_run_ledger (
  job_name text not null check (job_name = any(array[
    'daily-maintenance',
    'auto-draft-content',
    'publish-stories',
    'publish-feed',
    'weekly-report'
  ])),
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 40),
  status text not null check (status = any(array['running', 'succeeded', 'warning', 'failed'])),
  claim_token uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_started_at timestamptz,
  last_started_at timestamptz,
  lease_until timestamptz,
  completed_at timestamptz,
  result_summary text,
  updated_at timestamptz not null default now(),
  primary key (job_name, occurrence_key)
);

create index if not exists cron_run_ledger_status_updated_idx
  on cron_run_ledger(status, updated_at desc);

alter table cron_run_ledger enable row level security;
alter table cron_run_ledger force row level security;

drop policy if exists "service_role_all_cron_run_ledger" on cron_run_ledger;
create policy "service_role_all_cron_run_ledger"
  on cron_run_ledger for all to service_role using (true) with check (true);

revoke all on table cron_run_ledger from public, anon, authenticated;
grant select, insert, update, delete on table cron_run_ledger to service_role;

create or replace function claim_cron_run(
  p_job_name text,
  p_occurrence_key text,
  p_claim_token uuid,
  p_lease_seconds integer default 240
)
returns table(claimed boolean, run_status text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_name <> all(array[
    'daily-maintenance',
    'auto-draft-content',
    'publish-stories',
    'publish-feed',
    'weekly-report'
  ]) or char_length(p_occurrence_key) not between 1 and 40 then
    raise exception 'invalid_cron_run_identity';
  end if;

  return query
  with claimed_row as (
    insert into cron_run_ledger (
      job_name,
      occurrence_key,
      status,
      claim_token,
      attempt_count,
      first_started_at,
      last_started_at,
      lease_until,
      completed_at,
      result_summary,
      updated_at
    ) values (
      p_job_name,
      p_occurrence_key,
      'running',
      p_claim_token,
      1,
      now(),
      now(),
      now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 240), 600))),
      null,
      null,
      now()
    )
    on conflict (job_name, occurrence_key) do update
      set status = 'running',
          claim_token = excluded.claim_token,
          attempt_count = cron_run_ledger.attempt_count + 1,
          last_started_at = now(),
          lease_until = excluded.lease_until,
          completed_at = null,
          result_summary = null,
          updated_at = now()
      where cron_run_ledger.status = 'failed'
         or (cron_run_ledger.status = 'running' and cron_run_ledger.lease_until < now())
    returning true, cron_run_ledger.status, cron_run_ledger.attempt_count
  )
  select * from claimed_row
  union all
  select false, existing.status, existing.attempt_count
    from cron_run_ledger existing
   where existing.job_name = p_job_name
     and existing.occurrence_key = p_occurrence_key
     and not exists (select 1 from claimed_row)
  limit 1;
end;
$$;

create or replace function complete_cron_run(
  p_job_name text,
  p_occurrence_key text,
  p_claim_token uuid,
  p_status text,
  p_result_summary text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  did_update boolean := false;
begin
  if p_status <> all(array['succeeded', 'warning', 'failed']) then
    raise exception 'invalid_cron_run_status';
  end if;

  update cron_run_ledger
     set status = p_status,
         claim_token = null,
         lease_until = null,
         completed_at = now(),
         result_summary = left(p_result_summary, 2000),
         updated_at = now()
   where job_name = p_job_name
     and occurrence_key = p_occurrence_key
     and status = 'running'
     and claim_token = p_claim_token;

  did_update := found;
  return did_update;
end;
$$;

revoke all on function claim_cron_run(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function complete_cron_run(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function claim_cron_run(text, text, uuid, integer) to service_role;
grant execute on function complete_cron_run(text, text, uuid, text, text) to service_role;
