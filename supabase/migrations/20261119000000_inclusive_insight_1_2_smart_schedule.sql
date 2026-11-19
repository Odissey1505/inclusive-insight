-- =====================================================================
-- Inclusive Insight 1.2 — Smart Schedule
-- ---------------------------------------------------------------------
-- Weekly template + validity period + per-date exceptions.
-- No row is created per future lesson: lessons are computed in the app.
--
-- * New tables only (prefix ii_). Nothing else in the project is changed or
--   dropped, so it is safe in a Supabase project shared with other apps.
-- * Requires the 1.1 migration (ii_students, ii_subjects, ii_touch, ii_is_foreign,
--   ii_owns_student). Idempotent: safe to run more than once.
-- * Same model as 1.1: the full record in `data` (JSONB) + real columns for
--   relations, checks, indexes and RLS.
-- =====================================================================

-- Allow the ownership helper to check the new parent tables.
create or replace function public.ii_is_foreign(tbl text, ref uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found boolean;
begin
  if ref is null then
    return false;
  end if;
  if tbl not in ('ii_students', 'ii_subjects', 'ii_lessons', 'ii_observations',
                 'ii_strategies', 'ii_iep_goals', 'ii_schedule_templates') then
    raise exception 'ii_is_foreign: table % is not allowed', tbl;
  end if;
  execute format('select exists(select 1 from public.%I where id = $1 and user_id is distinct from $2)', tbl)
    into found using ref, auth.uid();
  return found;
end;
$$;
revoke all on function public.ii_is_foreign(text, uuid) from public, anon;
grant execute on function public.ii_is_foreign(text, uuid) to authenticated;

-- ---------- tables ----------------------------------------------------

-- A date-bounded schedule (e.g. "І семестр 2026/2027") of one student.
create table if not exists public.ii_schedule_periods (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  archived boolean not null default false,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ii_schedule_periods_dates check (end_date >= start_date)
);

-- One lesson of the weekly template. Template changes during a period create a new
-- version (effective_from) and close the old one (effective_to): history is kept.
create table if not exists public.ii_schedule_templates (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  period_id uuid not null references public.ii_schedule_periods (id) on delete cascade,
  weekday smallint not null,
  lesson_number smallint not null,
  subject_id uuid,
  start_time time,
  end_time time,
  effective_from date,
  effective_to date,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ii_schedule_templates_weekday check (weekday between 1 and 7),
  constraint ii_schedule_templates_number check (lesson_number between 0 and 20),
  constraint ii_schedule_templates_time check (start_time is null or end_time is null or end_time > start_time),
  constraint ii_schedule_templates_effective check (effective_from is null or effective_to is null or effective_to >= effective_from)
);

-- Exceptions for one date, separate from the template:
--   'slot'  = change/cancel one template lesson on that date (template_id)
--   'extra' = additional lesson
--   'day'   = no lessons that day (holiday, vacation, …) or shortened lessons
create table if not exists public.ii_schedule_overrides (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  period_id uuid not null references public.ii_schedule_periods (id) on delete cascade,
  date date not null,
  override_type text not null,
  template_id uuid references public.ii_schedule_templates (id) on delete cascade,
  subject_id uuid,
  lesson_number smallint,
  start_time time,
  end_time time,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ii_schedule_overrides_type check (override_type in ('slot', 'extra', 'day')),
  constraint ii_schedule_overrides_slot_ref check ((override_type = 'slot') = (template_id is not null)),
  constraint ii_schedule_overrides_number check (lesson_number is null or lesson_number between 0 and 20),
  constraint ii_schedule_overrides_time check (start_time is null or end_time is null or end_time > start_time)
);

-- ---------- duplicate protection & indexes ----------------------------

-- At most one change per template lesson per date, one day-exception per date.
create unique index if not exists ii_schedule_overrides_one_slot
  on public.ii_schedule_overrides (period_id, date, template_id) where override_type = 'slot';
create unique index if not exists ii_schedule_overrides_one_day
  on public.ii_schedule_overrides (period_id, date) where override_type = 'day';

create index if not exists ii_schedule_periods_user_student_idx on public.ii_schedule_periods (user_id, student_id, start_date, end_date);
create index if not exists ii_schedule_templates_period_idx on public.ii_schedule_templates (period_id, weekday, lesson_number);
create index if not exists ii_schedule_templates_user_student_idx on public.ii_schedule_templates (user_id, student_id);
create index if not exists ii_schedule_overrides_user_student_date_idx on public.ii_schedule_overrides (user_id, student_id, date);
create index if not exists ii_schedule_overrides_period_date_idx on public.ii_schedule_overrides (period_id, date);
create index if not exists ii_schedule_overrides_template_idx on public.ii_schedule_overrides (template_id);

-- ---------- overlapping main schedules --------------------------------
-- Two active (non-archived) schedules of the same student may not overlap.
-- The app offers to adjust dates first; this is the server-side safety net.
create or replace function public.ii_schedule_no_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.archived then
    return new;
  end if;
  if exists (
    select 1 from public.ii_schedule_periods p
    where p.student_id = new.student_id
      and p.id <> new.id
      and not p.archived
      and p.start_date <= new.end_date
      and new.start_date <= p.end_date
  ) then
    raise exception 'Schedule dates overlap another active schedule of this student'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists ii_schedule_periods_no_overlap on public.ii_schedule_periods;
create trigger ii_schedule_periods_no_overlap before insert or update on public.ii_schedule_periods
  for each row execute function public.ii_schedule_no_overlap();

-- ---------- triggers, RLS, grants, realtime ---------------------------

do $$
declare
  t text;
  tables text[] := array['ii_schedule_periods', 'ii_schedule_templates', 'ii_schedule_overrides'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.ii_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- Owner-only access + every parent must belong to the same user and student.
do $$
declare
  t text;
  chk text;
  checks jsonb := jsonb_build_object(
    'ii_schedule_periods',
      'public.ii_owns_student(student_id)',
    'ii_schedule_templates',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_schedule_periods p where p.id = period_id and p.user_id = (select auth.uid()) and p.student_id = ii_schedule_templates.student_id) and not public.ii_is_foreign(''ii_subjects'', subject_id)',
    'ii_schedule_overrides',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_schedule_periods p where p.id = period_id and p.user_id = (select auth.uid()) and p.student_id = ii_schedule_overrides.student_id) and (template_id is null or exists (select 1 from public.ii_schedule_templates s where s.id = template_id and s.user_id = (select auth.uid()) and s.period_id = ii_schedule_overrides.period_id)) and not public.ii_is_foreign(''ii_subjects'', subject_id)'
  );
begin
  for t, chk in select key, value #>> '{}' from jsonb_each(checks) loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and %s)', t || '_insert', t, chk);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and %s)', t || '_update', t, chk);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
  end loop;
end;
$$;
