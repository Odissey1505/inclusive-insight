/**
 * Mapping between local Dexie tables and Supabase tables.
 * The whole record (same shape as the TypeScript models) goes to `data` (JSONB);
 * relation / filter columns are extracted so the database can enforce ownership
 * of parents (RLS) and index by owner, student and date.
 */
import type { OwnerTable } from '../db/repositories';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const ref = (v: unknown) => (isUuid(v) ? v : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '1970-01-01');

type Row = Record<string, any>;

export interface TableSpec {
  local: OwnerTable;
  remote: string;
  /** Extra relational columns derived from the record. */
  columns: (r: Row) => Record<string, unknown>;
}

export const TABLE_SPECS: TableSpec[] = [
  { local: 'students', remote: 'ii_students', columns: () => ({}) },
  { local: 'subjects', remote: 'ii_subjects', columns: () => ({}) },
  { local: 'strategies', remote: 'ii_strategies', columns: () => ({}) },
  { local: 'templates', remote: 'ii_templates', columns: () => ({}) },
  { local: 'lessons', remote: 'ii_lessons', columns: (r) => ({ student_id: r.studentId, subject_id: ref(r.subjectId), date: day(r.date) }) },
  {
    local: 'observations', remote: 'ii_observations',
    columns: (r) => ({ student_id: r.studentId, lesson_id: ref(r.lessonId), subject_id: ref(r.subjectId), date: day(r.date), status: r.status === 'draft' ? 'draft' : 'final' }),
  },
  { local: 'tasks', remote: 'ii_observation_tasks', columns: (r) => ({ student_id: r.studentId, observation_id: r.observationId, date: day(r.date) }) },
  { local: 'events', remote: 'ii_observation_events', columns: (r) => ({ student_id: r.studentId, observation_id: r.observationId, date: day(r.date) }) },
  {
    local: 'strategyUses', remote: 'ii_strategy_uses',
    columns: (r) => ({ student_id: r.studentId, strategy_id: r.strategyId, observation_id: ref(r.observationId), date: day(r.date) }),
  },
  { local: 'iepGoals', remote: 'ii_iep_goals', columns: (r) => ({ student_id: r.studentId }) },
  {
    local: 'iepMeasurements', remote: 'ii_iep_measurements',
    columns: (r) => ({ student_id: r.studentId, goal_id: r.goalId, observation_id: ref(r.observationId), date: day(r.date) }),
  },
  {
    local: 'achievements', remote: 'ii_achievements',
    columns: (r) => ({ student_id: r.studentId, goal_id: ref(r.goalId), subject_id: ref(r.subjectId), date: day(r.date) }),
  },
];

export const SPEC_BY_LOCAL = new Map(TABLE_SPECS.map((s) => [s.local as string, s]));
export const SPEC_BY_REMOTE = new Map(TABLE_SPECS.map((s) => [s.remote, s]));
export const PROFILE_TABLE = 'ii_profiles';

/** Fields that only make sense on this device. */
const LOCAL_ONLY = new Set(['ownerId', 'isDemo']);

/** JSON-safe copy of a record without device-only fields. */
export function toData(record: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) if (!LOCAL_ONLY.has(k) && v !== undefined) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}

/** Row for insert/update in Supabase. */
export function toRemote(spec: TableSpec, uid: string, data: Row): Record<string, unknown> {
  return { id: data.id, user_id: uid, data: toData(data), ...spec.columns(data) };
}

/** Local record from a Supabase row. */
export function fromRemote(uid: string, row: { id: string; data: Row }): Row {
  return { ...row.data, id: row.id, ownerId: uid };
}

/** Content equality that ignores timestamps (used for idempotent retries and seed de-duplication). */
export function sameContent(a: Row | null | undefined, b: Row | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (r: Row) => {
    const { createdAt: _c, updatedAt: _u, ...rest } = toData(r) as Row;
    return JSON.stringify(sortKeys(rest));
  };
  return norm(a) === norm(b);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Row).sort().map((k) => [k, sortKeys((v as Row)[k])]));
  return v;
}

/** Deterministic UUID (SHA-256 based, RFC 4122 layout with version 8) — used for seeds and imports. */
export async function stableUuid(name: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('inclusive-insight:' + name))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
