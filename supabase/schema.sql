-- Enable required extensions
-- NOTE: Provision application login credentials via the Supabase Dashboard (Auth -> Users);
--       this schema intentionally avoids seeding auth.users directly to match dashboard flows.
create extension if not exists "pgcrypto";

-- Message templates stored per project
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  body text not null,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contact directory with searchable metadata and delivery status
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  company text,
  last_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text generated always as (
    case when last_sent_at is not null then 'green' else 'red' end
  ) stored,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(full_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(phone, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(company, '')), 'B')
  ) stored,
  constraint contacts_valid_phone check (phone is null or char_length(trim(phone)) >= 6),
  constraint contacts_phone_or_email check (phone is not null or email is not null)
);

drop index if exists public.contacts_phone_key;
drop index if exists public.contacts_email_key;

create unique index if not exists contacts_phone_key on public.contacts (phone);
create unique index if not exists contacts_email_key on public.contacts (email);
create index if not exists contacts_search_vector_idx on public.contacts using gin (search_vector);

create table if not exists public.contact_metrics (
  id integer primary key check (id = 1),
  total_contacts integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.send_metrics (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  recipient_count integer not null check (recipient_count >= 0),
  mode text not null default 'web',
  message_body text,
  template_id uuid references public.message_templates(id) on delete set null,
  created_by uuid,
  constraint send_metrics_body_or_template check (message_body is not null or template_id is not null),
  constraint send_metrics_mode check (mode in ('web', 'api'))
);

-- Per-contact delivery log linking metrics to contacts
create table if not exists public.contact_sends (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  send_metric_id uuid references public.send_metrics(id) on delete cascade,
  sent_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists contact_sends_contact_sent_idx on public.contact_sends (contact_id, sent_at desc);
create index if not exists contact_sends_metric_idx on public.contact_sends (send_metric_id);

-- Capture failed deliveries for reporting and rollups
create table if not exists public.send_failures (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  send_metric_id uuid references public.send_metrics(id) on delete cascade,
  failure_reason text not null,
  error_detail jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists send_failures_contact_idx on public.send_failures (contact_id, occurred_at desc);
create index if not exists send_failures_metric_idx on public.send_failures (send_metric_id);

-- Daily rollups for throughput analytics
create table if not exists public.send_daily_stats (
  stat_date date not null,
  mode text not null,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  failure_reasons jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (stat_date, mode)
);

create table if not exists public.service_heartbeats (
  id integer primary key check (id = 1),
  label text not null default 'massapp',
  last_ping timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Automatically set updated_at on templates
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_message_templates_updated_at
before update on public.message_templates
for each row execute procedure public.handle_updated_at();

create trigger set_contacts_updated_at
before update on public.contacts
for each row execute procedure public.handle_updated_at();

create trigger set_daily_stats_updated_at
before update on public.send_daily_stats
for each row execute procedure public.handle_updated_at();

create trigger set_service_heartbeats_updated_at
before update on public.service_heartbeats
for each row execute procedure public.handle_updated_at();

-- Row Level Security
alter table public.message_templates enable row level security;
alter table public.send_metrics enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_sends enable row level security;
alter table public.send_failures enable row level security;
alter table public.send_daily_stats enable row level security;
alter table public.service_heartbeats enable row level security;
alter table public.contact_metrics enable row level security;

-- Ensure created_by is recorded
create or replace function public.assign_created_by()
returns trigger as $$
begin
  if new.created_by is null then
    new.created_by = auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer;

create or replace function public.bump_contact_metrics(delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.contact_metrics (id, total_contacts)
  values (1, greatest(delta, 0))
  on conflict (id) do update
    set total_contacts = greatest(contact_metrics.total_contacts + delta, 0),
        updated_at = now();
end;
$$;

create or replace function public.handle_contact_metrics_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bump_contact_metrics(1);
  return new;
end;
$$;

create or replace function public.handle_contact_metrics_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bump_contact_metrics(-1);
  return old;
end;
$$;

create or replace function public.refresh_contact_metrics()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  select count(*) into total from public.contacts;
  insert into public.contact_metrics (id, total_contacts)
  values (1, total)
  on conflict (id) do update
    set total_contacts = total,
        updated_at = now();
  return total;
end;
$$;

create trigger set_send_metrics_created_by
before insert on public.send_metrics
for each row execute procedure public.assign_created_by();

create trigger set_contacts_created_by
before insert on public.contacts
for each row execute procedure public.assign_created_by();

create trigger increment_contact_metrics
after insert on public.contacts
for each row execute procedure public.handle_contact_metrics_insert();

create trigger decrement_contact_metrics
after delete on public.contacts
for each row execute procedure public.handle_contact_metrics_delete();

create trigger set_contact_sends_created_by
before insert on public.contact_sends
for each row execute procedure public.assign_created_by();

create trigger set_send_failures_created_by
before insert on public.send_failures
for each row execute procedure public.assign_created_by();

-- Maintain last_sent_at for contacts when new deliveries are recorded
create or replace function public.touch_contact_last_sent()
returns trigger as $$
begin
  update public.contacts as c
  set last_sent_at = greatest(coalesce(c.last_sent_at, new.sent_at), new.sent_at)
  where c.id = new.contact_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger set_contact_last_sent
after insert on public.contact_sends
for each row execute procedure public.touch_contact_last_sent();

-- Maintain daily rollups for successes and failures
create or replace function public.apply_daily_stats(stat_date date, mode text, success_inc integer, failure_inc integer, failure_reason text default null)
returns void
language plpgsql
security definer
as $$
declare
  safe_success integer := greatest(coalesce(success_inc, 0), 0);
  safe_failure integer := greatest(coalesce(failure_inc, 0), 0);
begin
  insert into public.send_daily_stats (stat_date, mode, success_count, failure_count, failure_reasons)
  values (
    stat_date,
    mode,
    safe_success,
    safe_failure,
    case
      when failure_reason is null or safe_failure = 0 then '{}'::jsonb
      else jsonb_build_object(failure_reason, safe_failure)
    end
  )
  on conflict (stat_date, mode)
  do update
    set success_count = public.send_daily_stats.success_count + safe_success,
        failure_count = public.send_daily_stats.failure_count + safe_failure,
        failure_reasons = case
          when failure_reason is null or safe_failure = 0 then public.send_daily_stats.failure_reasons
          else jsonb_set(
                 coalesce(public.send_daily_stats.failure_reasons, '{}'::jsonb),
                 array[failure_reason],
                 to_jsonb(coalesce((public.send_daily_stats.failure_reasons ->> failure_reason)::integer, 0) + safe_failure),
                 true)
        end,
        updated_at = now();
end;
$$;

create or replace function public.bump_daily_stats_for_success()
returns trigger
language plpgsql
security definer
as $$
declare
  metric public.send_metrics%rowtype;
  target_date date;
begin
  if new.send_metric_id is null then
    return new;
  end if;
  select * into metric from public.send_metrics where id = new.send_metric_id;
  if not found then
    return new;
  end if;
  target_date := date_trunc('day', coalesce(new.sent_at, metric.sent_at))::date;
  perform public.apply_daily_stats(target_date, metric.mode, 1, 0, null);
  return new;
end;
$$;

create trigger accumulate_daily_success
after insert on public.contact_sends
for each row execute procedure public.bump_daily_stats_for_success();

create or replace function public.bump_daily_stats_for_failure()
returns trigger
language plpgsql
security definer
as $$
declare
  metric public.send_metrics%rowtype;
  target_date date;
  failure_mode text := 'web';
begin
  if new.send_metric_id is not null then
    select * into metric from public.send_metrics where id = new.send_metric_id;
    if found then
      failure_mode := metric.mode;
      target_date := date_trunc('day', coalesce(new.occurred_at, metric.sent_at))::date;
    end if;
  end if;
  if target_date is null then
    target_date := date_trunc('day', coalesce(new.occurred_at, now()))::date;
  end if;
  perform public.apply_daily_stats(target_date, failure_mode, 0, 1, new.failure_reason);
  return new;
end;
$$;

create trigger accumulate_daily_failure
after insert on public.send_failures
for each row execute procedure public.bump_daily_stats_for_failure();

-- Policies for authenticated users
create policy "Authenticated users can manage templates"
on public.message_templates
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "Authenticated users can read metrics"
on public.send_metrics
for select
using (auth.role() = 'authenticated');

create policy "Authenticated users can insert metrics"
on public.send_metrics
for insert
with check (auth.role() = 'authenticated');

create policy "Authenticated users can manage contacts"
on public.contacts
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "Authenticated users can manage contact sends"
on public.contact_sends
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "Authenticated users can manage failures"
on public.send_failures
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "Authenticated users can read contact metrics"
on public.contact_metrics
for select
using (auth.role() = 'authenticated');

create policy "Block direct writes to contact metrics"
on public.contact_metrics
for all
using (false)
with check (false);

create policy "Authenticated users can read daily stats"
on public.send_daily_stats
for select
using (auth.role() = 'authenticated');

create policy "Service roles can maintain daily stats"
on public.send_daily_stats
for all
using (auth.role() in ('authenticated', 'service_role'))
with check (auth.role() in ('authenticated', 'service_role'));

create policy "Allow read access to service heartbeat"
on public.service_heartbeats
for select
using (auth.role() in ('anon', 'authenticated', 'service_role'));

create policy "Block direct writes to service heartbeat"
on public.service_heartbeats
for all
using (false)
with check (false);

-- Duplicate detection helpers
create or replace view public.contact_merge_candidates as
select
  lower(trim(full_name)) as normalized_name,
  array_agg(id order by created_at) as contact_ids,
  count(*) as contact_count,
  array_remove(array_agg(distinct phone), null) as phones,
  array_remove(array_agg(distinct email), null) as emails
from public.contacts
group by lower(trim(full_name))
having count(*) > 1;

create or replace function public.merge_contacts(primary_id uuid, secondary_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  primary_rec public.contacts%rowtype;
  secondary_rec public.contacts%rowtype;
  best_name text;
  best_phone text;
  best_email text;
  best_company text;
  best_last_sent timestamptz;
begin
  if primary_id = secondary_id then
    return primary_id;
  end if;

  select * into primary_rec from public.contacts where id = primary_id for update;
  if not found then
    raise exception 'Primary contact % not found', primary_id;
  end if;

  select * into secondary_rec from public.contacts where id = secondary_id for update;
  if not found then
    raise exception 'Secondary contact % not found', secondary_id;
  end if;

  best_name := case
    when coalesce(length(primary_rec.full_name), 0) >= coalesce(length(secondary_rec.full_name), 0) then primary_rec.full_name
    else secondary_rec.full_name
  end;

  best_phone := case
    when primary_rec.phone is null then secondary_rec.phone
    when secondary_rec.phone is null then primary_rec.phone
    when length(primary_rec.phone) >= length(secondary_rec.phone) then primary_rec.phone
    else secondary_rec.phone
  end;

  best_email := case
    when primary_rec.email is null then secondary_rec.email
    when secondary_rec.email is null then primary_rec.email
    when length(primary_rec.email) >= length(secondary_rec.email) then primary_rec.email
    else secondary_rec.email
  end;

  best_company := case
    when coalesce(length(primary_rec.company), 0) >= coalesce(length(secondary_rec.company), 0) then primary_rec.company
    else secondary_rec.company
  end;

  best_last_sent := greatest(coalesce(primary_rec.last_sent_at, '-infinity'::timestamptz), coalesce(secondary_rec.last_sent_at, '-infinity'::timestamptz));

  update public.contacts
  set full_name = best_name,
      phone = best_phone,
      email = best_email,
      company = best_company,
      last_sent_at = case
        when best_last_sent = '-infinity'::timestamptz then null
        else best_last_sent
      end,
      updated_at = now()
  where id = primary_id;

  update public.contact_sends
  set contact_id = primary_id
  where contact_id = secondary_id;

  update public.send_failures
  set contact_id = primary_id
  where contact_id = secondary_id;

  delete from public.contacts where id = secondary_id;

  return primary_id;
end;
$$;

grant execute on function public.merge_contacts(uuid, uuid) to authenticated;
grant execute on function public.refresh_contact_metrics() to service_role;

create or replace function public.touch_service_heartbeat()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ping timestamptz;
begin
  insert into public.service_heartbeats (id, label, last_ping)
  values (1, 'massapp', now())
  on conflict (id) do update
    set last_ping = now();

  select last_ping into current_ping from public.service_heartbeats where id = 1;
  return current_ping;
end;
$$;

grant execute on function public.touch_service_heartbeat() to anon, authenticated;

-- Password gate for the lightweight app login
create table if not exists public.app_password_guard (
  id integer primary key check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_password_guard enable row level security;

create policy "No direct access to app password"
on public.app_password_guard
for all
using (false)
with check (false);

create or replace function public.set_app_password(new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text;
begin
  if new_password is null or length(new_password) < 12 then
    raise exception 'Password must be at least 12 characters long';
  end if;
  hashed := crypt(new_password, gen_salt('bf'));
  insert into public.app_password_guard (id, password_hash)
  values (1, hashed)
  on conflict (id) do update set password_hash = excluded.password_hash, updated_at = now();
end;
$$;

create or replace function public.verify_app_password(candidate text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  stored text;
begin
  select password_hash into stored from public.app_password_guard where id = 1;
  if stored is null then
    return false;
  end if;
  return stored = crypt(candidate, stored);
end;
$$;

grant execute on function public.verify_app_password(text) to anon, authenticated;
