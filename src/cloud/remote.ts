/** RemoteStore implemented with supabase-js. All access is scoped by RLS to auth.uid(). */
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { PROFILE_TABLE, SPEC_BY_REMOTE } from './tables';
import { RemoteError, type ProfileRow, type RealtimeChange, type RemoteRow, type RemoteStore } from './types';

const COLS = 'id,version,data,updated_at';
const PAGE = 1000;

function toError(error: PostgrestError | null, status?: number): RemoteError {
  const code = error?.code ?? '';
  const msg = error?.message ?? 'Невідома помилка';
  if (!status || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return new RemoteError('network', 'Немає з’єднання з сервером', code);
  if (status >= 500) return new RemoteError('server', `Сервер тимчасово недоступний (${status})`, code);
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return new RemoteError('auth', 'Сесія завершилась — увійдіть знову', code);
  if (code === '23505') return new RemoteError('duplicate', 'Запис із таким ID уже існує', code);
  if (code === '42501' || status === 403) return new RemoteError('denied', 'Доступ заборонено правилами безпеки (RLS)', code);
  if (code === '23503') return new RemoteError('fk', 'Пов’язаний запис відсутній у хмарі (можливо, видалений на іншому пристрої)', code);
  if (code === '42P01' || code === 'PGRST205') return new RemoteError('invalid', 'Таблиці Inclusive Insight не знайдено — виконайте SQL-міграцію в Supabase', code);
  return new RemoteError('invalid', msg, code);
}

async function run<T>(p: PromiseLike<{ data: T; error: PostgrestError | null; status: number }>): Promise<T> {
  let res: { data: T; error: PostgrestError | null; status: number };
  try {
    res = await p;
  } catch (e) {
    throw new RemoteError('network', (e as Error).message || 'Немає з’єднання з сервером');
  }
  if (res.error) throw toError(res.error, res.status);
  return res.data;
}

export const supabaseRemote: RemoteStore = {
  async fetchAll(table, uid) {
    const out: RemoteRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await run<RemoteRow[]>(supabase().from(table).select(COLS).eq('user_id', uid).order('id').range(from, from + PAGE - 1) as any);
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  },
  async fetchOne(table, id) {
    return run<RemoteRow | null>(supabase().from(table).select(COLS).eq('id', id).maybeSingle() as any);
  },
  async insert(table, rows) {
    return run<RemoteRow[]>(supabase().from(table).insert(rows).select(COLS) as any);
  },
  async update(table, id, baseVersion, row) {
    const { id: _i, user_id: _u, ...patch } = row;
    const rows = await run<RemoteRow[]>(supabase().from(table).update(patch).eq('id', id).eq('version', baseVersion).select(COLS) as any);
    return rows[0] ?? null;
  },
  async remove(table, id, baseVersion) {
    const rows = await run<{ id: string }[]>(supabase().from(table).delete().eq('id', id).eq('version', baseVersion).select('id') as any);
    return rows.length > 0;
  },
  async getProfile(uid) {
    return run<ProfileRow | null>(supabase().from(PROFILE_TABLE).select('id,display_name,avatar,color,settings,version,updated_at').eq('id', uid).maybeSingle() as any);
  },
  async upsertProfile(row) {
    const { version: _v, updated_at: _u, ...rest } = row;
    await run(supabase().from(PROFILE_TABLE).upsert(rest).select('id') as any);
  },
  subscribe(uid, onChange, onStatus) {
    const ch = supabase().channel(`ii-sync-${uid}`);
    for (const remote of [...SPEC_BY_REMOTE.keys(), PROFILE_TABLE]) {
      const userFilter = remote === PROFILE_TABLE ? `id=eq.${uid}` : `user_id=eq.${uid}`;
      ch.on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: remote, filter: userFilter }, (p: any) => emit(remote, 'INSERT', p));
      ch.on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: remote, filter: userFilter }, (p: any) => emit(remote, 'UPDATE', p));
      // DELETE events cannot be filtered server-side; only the primary key arrives.
      // Ids that are not on this device are ignored by the engine.
      if (remote !== PROFILE_TABLE) ch.on('postgres_changes' as any, { event: 'DELETE', schema: 'public', table: remote }, (p: any) => emit(remote, 'DELETE', p));
    }
    function emit(table: string, type: RealtimeChange['type'], p: any) {
      if (table === PROFILE_TABLE) return onChange({ table, type, profile: p.new });
      if (type === 'DELETE') return onChange({ table, type, id: p.old?.id });
      const r = p.new;
      if (r?.user_id !== uid) return;
      onChange({ table, type, row: { id: r.id, version: r.version, data: r.data, updated_at: r.updated_at } });
    }
    onStatus('connecting');
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('on');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus('error');
      else if (status === 'CLOSED') onStatus('off');
    });
    return () => {
      void supabase().removeChannel(ch);
      onStatus('off');
    };
  },
};
