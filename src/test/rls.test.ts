/**
 * Row Level Security test: runs the real Supabase migration in PGlite (Postgres
 * compiled to WASM) with a minimal stand-in for Supabase's `auth` schema, then
 * acts as two different users through the `authenticated` role.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let pg: PGlite;

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${A}'), ('${B}');
`;

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return await pg.query<any>(sql, params);
  } finally {
    await pg.exec('reset role;');
  }
}

async function denied(user: string, sql: string, params: unknown[] = []) {
  try {
    await as(user, sql, params);
    return false;
  } catch (e) {
    return /row-level security|permission denied|violates/.test((e as Error).message);
  }
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  const dir = join(__dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    await pg.exec(sql);
    await pg.exec(sql); // migration must be idempotent
  }
  // User A's data
  await as(A, `insert into ii_students (id, user_id, data) values ($1, $2, '{}')`, [id(1), A]);
  await as(A, `insert into ii_subjects (id, user_id, data) values ($1, $2, '{}')`, [id(2), A]);
  await as(A, `insert into ii_observations (id, user_id, student_id, subject_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{"notes":"A"}')`, [id(3), A, id(1), id(2)]);
  await as(A, `insert into ii_observation_tasks (id, user_id, student_id, observation_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(4), A, id(1), id(3)]);
  await as(A, `insert into ii_iep_goals (id, user_id, student_id, data) values ($1, $2, $3, '{}')`, [id(5), A, id(1)]);
  await as(A, `insert into ii_strategies (id, user_id, data) values ($1, $2, '{}')`, [id(6), A]);
  await as(A, `insert into ii_profiles (id, display_name) values ($1, 'Олена')`, [A]);
  // User B's own student
  await as(B, `insert into ii_students (id, user_id, data) values ($1, $2, '{}')`, [id(11), B]);
  await as(B, `insert into ii_observations (id, user_id, student_id, date, data) values ($1, $2, $3, '2026-11-18', '{}')`, [id(13), B, id(11)]);
});

describe('Row Level Security (two accounts)', () => {
  it('owner sees own rows; the other user sees nothing', async () => {
    expect((await as(A, 'select id from ii_observations')).rows.map((r) => r.id)).toEqual([id(3)]);
    expect((await as(B, 'select id from ii_observations')).rows.map((r) => r.id)).toEqual([id(13)]);
    for (const t of ['ii_students', 'ii_observation_tasks', 'ii_iep_goals', 'ii_subjects', 'ii_strategies', 'ii_profiles']) {
      const rows = (await as(B, `select * from ${t}`)).rows;
      expect(rows.every((r) => (r.user_id ?? r.id) === B), t).toBe(true);
    }
  });

  it('B cannot read A rows even by explicit id', async () => {
    expect((await as(B, 'select * from ii_observations where id = $1', [id(3)])).rows).toHaveLength(0);
    expect((await as(B, 'select * from ii_profiles where id = $1', [A])).rows).toHaveLength(0);
  });

  it('B cannot update or delete A rows (0 rows affected, data intact)', async () => {
    const u = await as(B, `update ii_observations set data = '{"notes":"hacked"}' where id = $1`, [id(3)]);
    expect(u.affectedRows ?? 0).toBe(0);
    const d = await as(B, 'delete from ii_observation_tasks where id = $1', [id(4)]);
    expect(d.affectedRows ?? 0).toBe(0);
    const still = await as(A, 'select data from ii_observations where id = $1', [id(3)]);
    expect(still.rows[0].data.notes).toBe('A');
    expect((await as(A, 'select 1 from ii_observation_tasks where id = $1', [id(4)])).rows).toHaveLength(1);
  });

  it('B cannot insert rows owned by A', async () => {
    expect(await denied(B, `insert into ii_students (id, user_id, data) values ($1, $2, '{}')`, [id(20), A])).toBe(true);
  });

  it("B cannot attach records to A's student, observation, goal or strategy", async () => {
    expect(await denied(B, `insert into ii_lessons (id, user_id, student_id, date, data) values ($1, $2, $3, '2026-11-18', '{}')`, [id(21), B, id(1)])).toBe(true);
    expect(await denied(B, `insert into ii_observation_tasks (id, user_id, student_id, observation_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(22), B, id(11), id(3)])).toBe(true);
    expect(await denied(B, `insert into ii_iep_measurements (id, user_id, student_id, goal_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(23), B, id(11), id(5)])).toBe(true);
    expect(await denied(B, `insert into ii_strategy_uses (id, user_id, student_id, strategy_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(24), B, id(11), id(6)])).toBe(true);
    // soft references to another user's rows are rejected too
    expect(await denied(B, `insert into ii_observations (id, user_id, student_id, subject_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(25), B, id(11), id(2)])).toBe(true);
    expect(await denied(B, `insert into ii_achievements (id, user_id, student_id, goal_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(26), B, id(11), id(5)])).toBe(true);
  });

  it('B cannot move own rows into A account or under A student', async () => {
    await as(B, `update ii_observations set user_id = $1 where id = $2`, [A, id(13)]);
    expect((await as(B, 'select user_id from ii_observations where id = $1', [id(13)])).rows[0].user_id).toBe(B);
    expect(await denied(B, `update ii_observations set student_id = $1 where id = $2`, [id(1), id(13)])).toBe(true);
  });

  it('a soft reference to a missing row is allowed (deleted on another device)', async () => {
    await as(B, `insert into ii_achievements (id, user_id, student_id, goal_id, date, data) values ($1, $2, $3, $4, '2026-11-18', '{}')`, [id(27), B, id(11), id(999)]);
    expect((await as(B, 'select 1 from ii_achievements where id = $1', [id(27)])).rows).toHaveLength(1);
  });

  it('anonymous users have no access', async () => {
    expect(await denied(null as any, 'select * from ii_students').catch(() => true)).toBe(true);
  });

  it('server controls version and timestamps', async () => {
    const before = (await as(A, 'select version, created_at from ii_observations where id = $1', [id(3)])).rows[0];
    await as(A, `update ii_observations set data = '{"notes":"A2"}', version = 100, created_at = '2000-01-01' where id = $1`, [id(3)]);
    const after = (await as(A, 'select version, created_at from ii_observations where id = $1', [id(3)])).rows[0];
    expect(after.version).toBe(before.version + 1);
    expect(String(after.created_at)).toBe(String(before.created_at));
  });

  it('optimistic concurrency: update with a stale version changes nothing', async () => {
    const v = (await as(A, 'select version from ii_observations where id = $1', [id(3)])).rows[0].version;
    const stale = await as(A, `update ii_observations set data = '{"notes":"stale"}' where id = $1 and version = $2`, [id(3), v - 1]);
    expect(stale.affectedRows ?? 0).toBe(0);
    const ok = await as(A, `update ii_observations set data = '{"notes":"fresh"}' where id = $1 and version = $2`, [id(3), v]);
    expect(ok.affectedRows).toBe(1);
  });

  it('deleting a parent cascades to its children (no orphans)', async () => {
    await as(A, 'delete from ii_observations where id = $1', [id(3)]);
    expect((await as(A, 'select 1 from ii_observation_tasks where id = $1', [id(4)])).rows).toHaveLength(0);
  });

  it('the ownership helper refuses non-whitelisted tables', async () => {
    await expect(as(A, `select public.ii_is_foreign('pg_authid', $1)`, [id(1)])).rejects.toThrow();
  });
});
