-- =====================================================================
-- Inclusive Insight 1.1 — Supabase schema, versioning and Row Level Security
-- ---------------------------------------------------------------------
-- * All tables use the prefix ii_ so the app can live in a Supabase project
--   shared with other apps without name clashes.
-- * Every row: UUID id, user_id (= auth.uid()), version (optimistic
--   concurrency), created_at, updated_at.
-- * The full client record is stored in `data` (JSONB, same shape as the
--   app's TypeScript models) so analytics keep working unchanged; the
--   columns used for relations, filtering and indexing are real columns.
-- * RLS: a signed-in user can read and change ONLY rows where
--   user_id = auth.uid(), and may only link rows to parents they own.
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------- helpers ---------------------------------------------------

-- Server-controlled version / timestamps. Clients cannot forge them,
-- and user_id / created_at cannot be changed after insert.
create or replace function public.ii_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  else
    new.version := old.version + 1;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- True when a referenced row exists AND belongs to another user.
-- SECURITY DEFINER so it can see rows hidden by RLS; the table name is
-- whitelisted, so it cannot be used to probe other tables.
-- A missing reference returns false (soft references are allowed to dangle,
-- e.g. a lesson deleted on another device).
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
                 'ii_strategies', 'ii_iep_goals') then
    raise exception 'ii_is_foreign: table % is not allowed', tbl;
  end if;
  execute format('select exists(select 1 from public.%I where id = $1 and user_id is distinct from $2)', tbl)
    into found using ref, auth.uid();
  return found;
end;
$$;
revoke all on function public.ii_is_foreign(text, uuid) from public, anon;
grant execute on function public.ii_is_foreign(text, uuid) to authenticated;


-- ---------- profiles (display name, avatar, synced UI preferences) ----

create table if not exists public.ii_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar text not null default '🌿',
  color text not null default '#5B9BD5',
  settings jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.ii_touch_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    new.version := old.version + 1;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ii_profiles_touch on public.ii_profiles;
create trigger ii_profiles_touch before insert or update on public.ii_profiles
  for each row execute function public.ii_touch_profile();

-- ---------- data tables -----------------------------------------------

create table if not exists public.ii_students (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_subjects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_strategies (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_templates (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_lessons (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  subject_id uuid,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_observations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  lesson_id uuid,
  subject_id uuid,
  date date not null,
  status text not null default 'final' check (status in ('draft', 'final')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_observation_tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  observation_id uuid not null references public.ii_observations (id) on delete cascade,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_observation_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  observation_id uuid not null references public.ii_observations (id) on delete cascade,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_strategy_uses (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  strategy_id uuid not null references public.ii_strategies (id) on delete cascade,
  observation_id uuid references public.ii_observations (id) on delete cascade,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_iep_goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_iep_measurements (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  goal_id uuid not null references public.ii_iep_goals (id) on delete cascade,
  observation_id uuid,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ii_achievements (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_id uuid not null references public.ii_students (id) on delete cascade,
  goal_id uuid,
  subject_id uuid,
  date date not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- True when the student belongs to the current user (RLS-scoped lookup).
create or replace function public.ii_owns_student(sid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists(select 1 from public.ii_students s where s.id = sid and s.user_id = auth.uid());
$$;

-- ---------- indexes ---------------------------------------------------

create index if not exists ii_students_user_idx on public.ii_students (user_id);
create index if not exists ii_subjects_user_idx on public.ii_subjects (user_id);
create index if not exists ii_strategies_user_idx on public.ii_strategies (user_id);
create index if not exists ii_templates_user_idx on public.ii_templates (user_id);
create index if not exists ii_lessons_user_student_date_idx on public.ii_lessons (user_id, student_id, date);
create index if not exists ii_observations_user_student_date_idx on public.ii_observations (user_id, student_id, date);
create index if not exists ii_observations_lesson_idx on public.ii_observations (lesson_id);
create index if not exists ii_tasks_user_student_date_idx on public.ii_observation_tasks (user_id, student_id, date);
create index if not exists ii_tasks_observation_idx on public.ii_observation_tasks (observation_id);
create index if not exists ii_events_user_student_date_idx on public.ii_observation_events (user_id, student_id, date);
create index if not exists ii_events_observation_idx on public.ii_observation_events (observation_id);
create index if not exists ii_uses_user_student_date_idx on public.ii_strategy_uses (user_id, student_id, date);
create index if not exists ii_uses_strategy_idx on public.ii_strategy_uses (strategy_id);
create index if not exists ii_uses_observation_idx on public.ii_strategy_uses (observation_id);
create index if not exists ii_goals_user_student_idx on public.ii_iep_goals (user_id, student_id);
create index if not exists ii_measurements_user_student_date_idx on public.ii_iep_measurements (user_id, student_id, date);
create index if not exists ii_measurements_goal_idx on public.ii_iep_measurements (goal_id);
create index if not exists ii_achievements_user_student_date_idx on public.ii_achievements (user_id, student_id, date);

-- ---------- triggers, RLS, grants, realtime ---------------------------

do $$
declare
  t text;
  tables text[] := array[
    'ii_students', 'ii_subjects', 'ii_strategies', 'ii_templates', 'ii_lessons',
    'ii_observations', 'ii_observation_tasks', 'ii_observation_events',
    'ii_strategy_uses', 'ii_iep_goals', 'ii_iep_measurements', 'ii_achievements'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.ii_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- Realtime (postgres_changes respects RLS). Only if the publication exists.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables || array['ii_profiles'] loop
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

alter table public.ii_profiles enable row level security;
revoke all on public.ii_profiles from anon;
grant select, insert, update, delete on public.ii_profiles to authenticated;

-- ---------- policies --------------------------------------------------
-- Pattern: (select auth.uid()) is evaluated once per statement (faster).

-- profiles
drop policy if exists ii_profiles_select on public.ii_profiles;
drop policy if exists ii_profiles_insert on public.ii_profiles;
drop policy if exists ii_profiles_update on public.ii_profiles;
drop policy if exists ii_profiles_delete on public.ii_profiles;
create policy ii_profiles_select on public.ii_profiles for select to authenticated using (id = (select auth.uid()));
create policy ii_profiles_insert on public.ii_profiles for insert to authenticated with check (id = (select auth.uid()));
create policy ii_profiles_update on public.ii_profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy ii_profiles_delete on public.ii_profiles for delete to authenticated using (id = (select auth.uid()));

-- Owner-only tables without parents
do $$
declare
  t text;
begin
  foreach t in array array['ii_students', 'ii_subjects', 'ii_strategies', 'ii_templates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
  end loop;
end;
$$;

-- Child tables: same owner check + every linked parent must belong to the
-- same user (hard parents must exist; soft references may dangle but can
-- never point at another user's row).
do $$
declare
  t text;
  chk text;
  checks jsonb := jsonb_build_object(
    'ii_lessons',
      'public.ii_owns_student(student_id) and not public.ii_is_foreign(''ii_subjects'', subject_id)',
    'ii_observations',
      'public.ii_owns_student(student_id) and not public.ii_is_foreign(''ii_lessons'', lesson_id) and not public.ii_is_foreign(''ii_subjects'', subject_id)',
    'ii_observation_tasks',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_observations o where o.id = observation_id and o.user_id = (select auth.uid()) and o.student_id = ii_observation_tasks.student_id)',
    'ii_observation_events',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_observations o where o.id = observation_id and o.user_id = (select auth.uid()) and o.student_id = ii_observation_events.student_id)',
    'ii_strategy_uses',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_strategies s where s.id = strategy_id and s.user_id = (select auth.uid())) and (observation_id is null or exists (select 1 from public.ii_observations o where o.id = observation_id and o.user_id = (select auth.uid()) and o.student_id = ii_strategy_uses.student_id))',
    'ii_iep_goals',
      'public.ii_owns_student(student_id)',
    'ii_iep_measurements',
      'public.ii_owns_student(student_id) and exists (select 1 from public.ii_iep_goals g where g.id = goal_id and g.user_id = (select auth.uid()) and g.student_id = ii_iep_measurements.student_id) and not public.ii_is_foreign(''ii_observations'', observation_id)',
    'ii_achievements',
      'public.ii_owns_student(student_id) and not public.ii_is_foreign(''ii_iep_goals'', goal_id) and not public.ii_is_foreign(''ii_subjects'', subject_id)'
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
