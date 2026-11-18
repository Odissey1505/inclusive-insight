/**
 * Cloud sync engine (Inclusive Insight 1.1).
 *
 * Supabase is the source of truth. IndexedDB keeps:
 *   - a cached copy of the signed-in user's records (so every page, the analytics
 *     and the report generators keep reading the same local tables as in 1.0);
 *   - an outbox of local changes that have not reached the cloud yet;
 *   - the last server version seen for each record (optimistic concurrency);
 *   - unresolved conflicts.
 *
 * Local writes made through the repositories are captured by Dexie hooks, so
 * the repositories and pages stay unchanged. Writes coming FROM the cloud are
 * made inside transactions tagged as "remote" and are never sent back (no loops).
 *
 * Guarantees: stable client-generated UUIDs, persistent queue, retries with
 * back-off, idempotent inserts (duplicate id + same content = success),
 * version-checked updates/deletes, and an explicit conflict UI instead of
 * silently overwriting newer data.
 */
import type { Transaction } from 'dexie';
import { db, type InsightDB } from '../db/database';
import { SPEC_BY_LOCAL, SPEC_BY_REMOTE, TABLE_SPECS, fromRemote, sameContent, toData, toRemote, type TableSpec } from './tables';
import { RemoteError, type ConflictEntry, type OutboxEntry, type ProfileRow, type RealtimeChange, type RemoteRow, type RemoteStore } from './types';

/* ------------------------------------------------------------------ */
/* Status store (consumed with useSyncExternalStore)                   */
/* ------------------------------------------------------------------ */

export interface SyncStatus {
  active: boolean;
  uid: string | null;
  online: boolean;
  busy: 'idle' | 'pulling' | 'pushing';
  connection: 'unknown' | 'ok' | 'offline' | 'error';
  realtime: 'off' | 'connecting' | 'on' | 'error';
  lastPullAt: number | null;
  lastPushAt: number | null;
  initialPullDone: boolean;
  pullComplete: boolean;
  failedTables: string[];
  lastError: string | null;
  authExpired: boolean;
  pending: number;
  failed: number;
  conflicts: number;
}

const initial: SyncStatus = {
  active: false, uid: null, online: typeof navigator === 'undefined' ? true : navigator.onLine, busy: 'idle', connection: 'unknown',
  realtime: 'off', lastPullAt: null, lastPushAt: null, initialPullDone: false, pullComplete: false, failedTables: [],
  lastError: null, authExpired: false, pending: 0, failed: 0, conflicts: 0,
};

let status: SyncStatus = { ...initial };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export const syncStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => status,
};

/* ------------------------------------------------------------------ */
/* Engine state                                                        */
/* ------------------------------------------------------------------ */

let remote: RemoteStore | null = null;
let uid: string | null = null;
let generation = 0; // bumps on start/stop so stale async work is ignored
const remoteIdbTx = new WeakSet<IDBTransaction>();
const txOps = new WeakMap<IDBTransaction, Captured[]>();
const capturing = new Map<string, number>(); // keys captured but not yet in the outbox
let inflightKey: string | null = null;
let pushing = false;
let pushAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 2000;
let unsubscribeRealtime: (() => void) | null = null;
let profileTimer: ReturnType<typeof setTimeout> | null = null;
let lastProfileSent = '';
let cleanup: (() => void)[] = [];
const attached = new WeakSet<InsightDB>();

interface Captured {
  table: string;
  id: string;
  key: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown> | null;
}

const keyOf = (table: string, id: string) => `${table}:${id}`;
const isActive = () => !!uid && !!remote;

/* ------------------------------------------------------------------ */
/* Change capture (Dexie hooks)                                         */
/* ------------------------------------------------------------------ */

function idbOf(trans: Transaction | undefined): IDBTransaction | undefined {
  return (trans as any)?.idbtrans as IDBTransaction | undefined;
}

function relevant(obj: any, trans: Transaction): boolean {
  if (!uid || !obj || obj.ownerId !== uid || obj.isDemo) return false; // demo data never leaves the device
  const idb = idbOf(trans);
  return !(idb && remoteIdbTx.has(idb));
}

function capture(trans: Transaction, table: string, obj: any, op: 'upsert' | 'delete') {
  const idb = idbOf(trans);
  const key = keyOf(table, obj.id);
  const entry: Captured = { table, id: obj.id, key, op, payload: op === 'upsert' ? toData(obj) : null };
  capturing.set(key, (capturing.get(key) ?? 0) + 1);
  if (!idb) {
    void flush([entry]);
    return;
  }
  let list = txOps.get(idb);
  if (!list) {
    list = [];
    txOps.set(idb, list);
    const done = list;
    idb.addEventListener('complete', () => void flush(done));
    const drop = () => done.forEach((c) => release(c.key));
    idb.addEventListener('abort', drop);
    idb.addEventListener('error', drop);
  }
  list.push(entry);
}

function release(key: string) {
  const n = (capturing.get(key) ?? 1) - 1;
  if (n <= 0) capturing.delete(key);
  else capturing.set(key, n);
}

export function attachSyncHooks(database: InsightDB = db) {
  if (attached.has(database)) return;
  attached.add(database);
  for (const spec of TABLE_SPECS) {
    const t = database.table(spec.local);
    t.hook('creating', function (_pk, obj, trans) {
      if (relevant(obj, trans)) capture(trans, spec.local, obj, 'upsert');
    });
    t.hook('updating', function (this: any, _mods, _pk, obj, trans) {
      if (!relevant(obj, trans)) return;
      this.onsuccess = (updated: any) => {
        if (updated?.ownerId === uid && !updated.isDemo) capture(trans, spec.local, updated, 'upsert');
      };
    });
    t.hook('deleting', function (_pk, obj, trans) {
      if (relevant(obj, trans)) capture(trans, spec.local, obj, 'delete');
    });
  }
  // Profile (name / avatar) and UI preferences follow the account across devices.
  const onProfileTouch = (obj: any, trans: Transaction) => {
    if (!uid) return;
    const idb = idbOf(trans);
    if (idb && remoteIdbTx.has(idb)) return;
    if (obj?.id === uid || obj?.id === `user:${uid}`) scheduleProfilePush();
  };
  for (const t of [database.users, database.settings] as any[]) {
    t.hook('creating', (_pk: unknown, obj: any, trans: Transaction) => onProfileTouch(obj, trans));
    t.hook('updating', (_m: unknown, _pk: unknown, obj: any, trans: Transaction) => onProfileTouch(obj, trans));
  }
}

/** Merge captured changes into the persistent outbox (coalescing repeated edits). */
async function flush(list: Captured[]) {
  if (!list.length) return;
  const owner = uid;
  if (!owner) {
    list.forEach((c) => release(c.key));
    return;
  }
  try {
    await db.transaction('rw', db.outbox, db.versions, async () => {
      for (const c of list) {
        const existing = await db.outbox
          .where('key').equals(c.key)
          .filter((e) => e.uid === owner && !(inflightKey === c.key && e.seq === inflightSeq))
          .last();
        const known = await db.versions.get(c.key);
        const now = Date.now();
        if (!existing) {
          if (c.op === 'delete' && !known && inflightKey !== c.key) continue; // never reached the cloud
          await db.outbox.add({ uid: owner, key: c.key, table: c.table, rowId: c.id, op: c.op, payload: c.payload, state: 'pending', attempts: 0, createdAt: now, updatedAt: now });
        } else if (c.op === 'upsert') {
          await db.outbox.update(existing.seq!, { op: 'upsert', payload: c.payload, state: 'pending', attempts: 0, lastError: undefined, updatedAt: now });
        } else if (existing.op === 'upsert' && !known && inflightKey !== c.key) {
          await db.outbox.delete(existing.seq!);
        } else {
          await db.outbox.update(existing.seq!, { op: 'delete', payload: null, state: 'pending', attempts: 0, lastError: undefined, updatedAt: now });
        }
      }
    });
  } finally {
    list.forEach((c) => release(c.key));
  }
  await refreshCounts();
  schedulePush(0);
}

/* ------------------------------------------------------------------ */
/* Applying cloud data locally                                          */
/* ------------------------------------------------------------------ */

const LOCAL_TABLES = () => [...TABLE_SPECS.map((s) => db.table(s.local)), db.versions, db.users, db.settings, db.outbox, db.conflicts];

async function asRemote<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', LOCAL_TABLES(), async (tx) => {
    const idb = idbOf(tx as any);
    if (idb) remoteIdbTx.add(idb);
    return fn();
  });
}

/** Keys that must not be overwritten from the cloud: unsent local edits and conflicts. */
async function blockedKeys(owner: string): Promise<Set<string>> {
  const s = new Set<string>(capturing.keys());
  (await db.outbox.where('uid').equals(owner).toArray()).forEach((e) => s.add(e.key));
  (await db.conflicts.where('uid').equals(owner).toArray()).forEach((c) => s.add(c.key));
  if (inflightKey) s.add(inflightKey);
  return s;
}

async function applyRows(spec: TableSpec, rows: RemoteRow[], owner: string, blocked: Set<string>) {
  const table = db.table(spec.local);
  for (const r of rows) {
    const key = keyOf(spec.local, r.id);
    if (blocked.has(key)) continue;
    const known = await db.versions.get(key);
    if (known && known.version >= r.version && (await table.get(r.id))) continue;
    await table.put(fromRemote(owner, r));
    await db.versions.put({ key, uid: owner, version: r.version });
  }
}

async function applyProfile(owner: string, p: ProfileRow | null) {
  if (!p) return;
  const user = await db.users.get(owner);
  const patch = { name: p.display_name || user?.name || '', avatar: p.avatar || user?.avatar || '🌿', color: p.color || user?.color || '#5B9BD5' };
  if (user) await db.users.update(owner, patch);
  else await db.users.put({ id: owner, ...patch, createdAt: Date.now(), lastActiveAt: Date.now() });
  const s = (p.settings ?? {}) as Record<string, unknown>;
  const cur = (await db.settings.get(`user:${owner}`)) ?? { id: `user:${owner}`, ownerId: owner, activeStudentId: null };
  const next = { ...cur } as any;
  for (const k of ['theme', 'compact', 'animations'] as const) if (k in s) next[k] = s[k];
  await db.settings.put(next);
  lastProfileSent = profileSnapshot(patch.name, patch, next);
}

/* ------------------------------------------------------------------ */
/* Pull (full refresh)                                                  */
/* ------------------------------------------------------------------ */

let pulling: Promise<void> | null = null;

/** Downloads all of the user's records and reconciles the local cache. */
export function refresh(): Promise<void> {
  if (!isActive()) return Promise.resolve();
  if (!pulling) pulling = doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull() {
  const owner = uid!;
  const gen = generation;
  const r = remote!;
  set({ busy: 'pulling' });
  const results = new Map<TableSpec, RemoteRow[]>();
  const failed: string[] = [];
  let profile: ProfileRow | null = null;
  let firstError: RemoteError | null = null;
  try {
    profile = await r.getProfile(owner);
  } catch (e) {
    firstError = e as RemoteError;
  }
  if (!firstError || (firstError as RemoteError).kind !== 'network') {
    await Promise.all(TABLE_SPECS.map(async (spec) => {
      try {
        results.set(spec, await r.fetchAll(spec.remote, owner));
      } catch (e) {
        failed.push(spec.local);
        firstError ??= e as RemoteError;
      }
    }));
  } else {
    failed.push(...TABLE_SPECS.map((s) => s.local));
  }
  if (gen !== generation) return;

  const recover: { spec: TableSpec; row: any }[] = [];
  await asRemote(async () => {
    const blocked = await blockedKeys(owner);
    await applyProfile(owner, profile);
    for (const [spec, rows] of results) {
      const table = db.table(spec.local);
      const ids = new Set(rows.map((x) => x.id));
      const local = await table.where('ownerId').equals(owner).toArray();
      for (const l of local) {
        if (l.isDemo || ids.has(l.id)) continue;
        const key = keyOf(spec.local, l.id);
        if (blocked.has(key)) continue;
        if (await db.versions.get(key)) {
          await table.delete(l.id); // deleted on another device
          await db.versions.delete(key);
        } else {
          recover.push({ spec, row: l }); // local record that never reached the cloud
        }
      }
      await applyRows(spec, rows, owner, blocked);
    }
  });
  if (gen !== generation) return;

  // Re-queue local records that somehow never got an outbox entry.
  if (recover.length) {
    const now = Date.now();
    await db.outbox.bulkAdd(recover.map(({ spec, row }) => ({
      uid: owner, key: keyOf(spec.local, row.id), table: spec.local, rowId: row.id, op: 'upsert' as const,
      payload: toData(row), state: 'pending' as const, attempts: 0, createdAt: now, updatedAt: now,
    })));
  }

  const ok = failed.length === 0 && !firstError;
  set({
    busy: 'idle',
    lastPullAt: ok ? Date.now() : status.lastPullAt,
    initialPullDone: status.initialPullDone || ok,
    pullComplete: ok,
    failedTables: failed,
    connection: ok ? 'ok' : (firstError as RemoteError | null)?.kind === 'network' ? 'offline' : 'error',
    lastError: firstError ? (firstError as RemoteError).message : null,
    authExpired: (firstError as RemoteError | null)?.kind === 'auth',
  });
  if (ok && !profile) scheduleProfilePush(0);
  await refreshCounts();
  schedulePush(0);
}

/* ------------------------------------------------------------------ */
/* Push (outbox processing)                                             */
/* ------------------------------------------------------------------ */

let inflightSeq: number | null = null;

export function schedulePush(delay = 300) {
  if (!isActive()) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processQueue();
  }, delay);
}

const INSERT_BATCH = 200;

async function processQueue() {
  if (!isActive()) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  const owner = uid!;
  const gen = generation;
  let sent = 0;
  try {
    for (;;) {
      if (gen !== generation) return;
      const head = await db.outbox.where('uid').equals(owner).filter((e) => e.state === 'pending').first();
      if (!head) break;
      set({ busy: 'pushing' });
      // Batch consecutive brand-new inserts of the same table (fast first upload / import).
      const batch = await insertBatch(owner, head);
      if (batch.length > 1) {
        const done = await pushInsertBatch(owner, batch);
        if (gen !== generation) return;
        if (done) {
          sent += batch.length;
          continue;
        }
      }
      await pushOne(owner, head);
      sent++;
      backoff = 2000;
    }
    set({ busy: 'idle', connection: 'ok', lastError: null, authExpired: false, lastPushAt: sent ? Date.now() : status.lastPushAt });
  } catch (e) {
    const err = e instanceof RemoteError ? e : new RemoteError('network', (e as Error).message);
    set({ busy: 'idle', connection: err.kind === 'network' ? 'offline' : 'error', lastError: err.message, authExpired: err.kind === 'auth' });
    if (err.retryable) {
      schedulePush(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  } finally {
    inflightKey = null;
    inflightSeq = null;
    pushing = false;
    await refreshCounts();
    if (pushAgain) {
      pushAgain = false;
      schedulePush(0);
    }
  }
}

async function insertBatch(owner: string, head: OutboxEntry): Promise<OutboxEntry[]> {
  if (head.op !== 'upsert' || (await db.versions.get(head.key))) return [head];
  const next = await db.outbox.where('uid').equals(owner).filter((e) => e.state === 'pending').limit(INSERT_BATCH).toArray();
  const out: OutboxEntry[] = [];
  for (const e of next) {
    if (e.table !== head.table || e.op !== 'upsert' || (await db.versions.get(e.key))) break;
    if (out.some((o) => o.key === e.key)) break;
    out.push(e);
  }
  return out;
}

/** Returns false when the batch must be retried row by row (e.g. one duplicate). */
async function pushInsertBatch(owner: string, batch: OutboxEntry[]): Promise<boolean> {
  const spec = SPEC_BY_LOCAL.get(batch[0].table)!;
  try {
    const rows = await remote!.insert(spec.remote, batch.map((e) => toRemote(spec, owner, e.payload as any)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    await db.transaction('rw', db.outbox, db.versions, async () => {
      for (const e of batch) {
        const r = byId.get(e.rowId);
        if (r) await db.versions.put({ key: e.key, uid: owner, version: r.version });
        await db.outbox.delete(e.seq!);
      }
    });
    return true;
  } catch (e) {
    if (e instanceof RemoteError && e.retryable) throw e;
    return false;
  }
}

async function pushOne(owner: string, e: OutboxEntry) {
  const spec = SPEC_BY_LOCAL.get(e.table);
  if (!spec) {
    await db.outbox.delete(e.seq!);
    return;
  }
  inflightKey = e.key;
  inflightSeq = e.seq!;
  const known = await db.versions.get(e.key);
  const r = remote!;
  try {
    if (e.op === 'delete') {
      if (!known) return void (await db.outbox.delete(e.seq!));
      const ok = await r.remove(spec.remote, e.rowId, known.version);
      if (ok) return void (await ack(e, null));
      const current = await r.fetchOne(spec.remote, e.rowId);
      if (!current) return void (await ack(e, null)); // already gone
      return void (await conflict(owner, e, 'local-delete', current));
    }

    const row = toRemote(spec, owner, e.payload as any);
    if (!known) {
      try {
        const [created] = await r.insert(spec.remote, [row]);
        return void (await ack(e, created ?? null));
      } catch (err) {
        if (!(err instanceof RemoteError) || err.kind !== 'duplicate') throw err;
        const current = await r.fetchOne(spec.remote, e.rowId);
        if (current && sameContent(current.data, e.payload)) return void (await ack(e, current)); // retried insert
        if (current) return void (await conflict(owner, e, 'modified', current));
        throw err;
      }
    }
    const updated = await r.update(spec.remote, e.rowId, known.version, row);
    if (updated) return void (await ack(e, updated));
    const current = await r.fetchOne(spec.remote, e.rowId);
    if (!current) return void (await conflict(owner, e, 'remote-deleted', null));
    if (sameContent(current.data, e.payload)) return void (await ack(e, current));
    await conflict(owner, e, 'modified', current);
  } catch (err) {
    if (err instanceof RemoteError && (err.retryable || err.kind === 'auth')) throw err;
    await db.outbox.update(e.seq!, { state: 'failed', attempts: e.attempts + 1, lastError: (err as Error).message, updatedAt: Date.now() });
  }
}

async function ack(e: OutboxEntry, row: RemoteRow | null) {
  await db.transaction('rw', db.outbox, db.versions, async () => {
    if (row) await db.versions.put({ key: e.key, uid: e.uid, version: row.version });
    else await db.versions.delete(e.key);
    await db.outbox.delete(e.seq!);
  });
}

async function conflict(owner: string, e: OutboxEntry, kind: ConflictEntry['kind'], current: RemoteRow | null) {
  await db.transaction('rw', db.outbox, db.conflicts, async () => {
    await db.conflicts.put({ key: e.key, uid: owner, table: e.table, rowId: e.rowId, kind, local: e.payload, remote: current, createdAt: Date.now() });
    await db.outbox.delete(e.seq!);
  });
}

/* ------------------------------------------------------------------ */
/* Conflicts & failed changes                                           */
/* ------------------------------------------------------------------ */

export async function listConflicts(): Promise<ConflictEntry[]> {
  return uid ? db.conflicts.where('uid').equals(uid).toArray() : [];
}

/** Keep this device's version: it becomes the newest version in the cloud. */
export async function resolveKeepLocal(key: string) {
  const c = await db.conflicts.get(key);
  if (!c || !uid) return;
  const now = Date.now();
  await db.transaction('rw', db.conflicts, db.outbox, db.versions, async () => {
    if (c.remote) await db.versions.put({ key, uid: c.uid, version: c.remote.version });
    else await db.versions.delete(key);
    await db.outbox.add({
      uid: c.uid, key, table: c.table, rowId: c.rowId, op: c.kind === 'local-delete' ? 'delete' : 'upsert',
      payload: c.kind === 'local-delete' ? null : c.local, state: 'pending', attempts: 0, createdAt: now, updatedAt: now,
    });
    await db.conflicts.delete(key);
  });
  await refreshCounts();
  schedulePush(0);
}

/** Take the cloud version and discard this device's change. */
export async function resolveTakeRemote(key: string) {
  const c = await db.conflicts.get(key);
  if (!c || !uid) return;
  const owner = uid;
  const spec = SPEC_BY_LOCAL.get(c.table)!;
  await db.conflicts.delete(key);
  await asRemote(async () => {
    const table = db.table(spec.local);
    if (c.remote) {
      await table.put(fromRemote(owner, c.remote));
      await db.versions.put({ key, uid: owner, version: c.remote.version });
    } else {
      await table.delete(c.rowId);
      await db.versions.delete(key);
    }
  });
  await refreshCounts();
}

export async function listFailed(): Promise<OutboxEntry[]> {
  return uid ? db.outbox.where('uid').equals(uid).filter((e) => e.state === 'failed').toArray() : [];
}

export async function retryFailed() {
  if (!uid) return;
  await db.outbox.where('uid').equals(uid).filter((e) => e.state === 'failed').modify({ state: 'pending', attempts: 0, lastError: undefined });
  await refreshCounts();
  schedulePush(0);
}

/** Drop a change that cannot be applied and reload the cloud version. */
export async function discardFailed(seq: number) {
  const e = await db.outbox.get(seq);
  if (!e) return;
  await db.outbox.delete(seq);
  await db.versions.delete(e.key); // forces the cloud copy to be re-applied
  await refreshCounts();
  await refresh();
}

/* ------------------------------------------------------------------ */
/* Realtime                                                             */
/* ------------------------------------------------------------------ */

async function onRealtime(c: RealtimeChange) {
  if (!uid) return;
  const owner = uid;
  if (c.profile) {
    await asRemote(() => applyProfile(owner, c.profile!));
    return;
  }
  const spec = SPEC_BY_REMOTE.get(c.table);
  if (!spec) return;
  await asRemote(async () => {
    const blocked = await blockedKeys(owner);
    if (c.type === 'DELETE') {
      if (!c.id) return;
      const key = keyOf(spec.local, c.id);
      if (blocked.has(key)) return;
      const table = db.table(spec.local);
      const local = await table.get(c.id);
      if (local && local.ownerId === owner && !local.isDemo) {
        await table.delete(c.id);
        await db.versions.delete(key);
      }
      return;
    }
    if (c.row) await applyRows(spec, [c.row], owner, blocked);
  });
}

/* ------------------------------------------------------------------ */
/* Profile push (last write wins — only name/avatar/colour/UI prefs)   */
/* ------------------------------------------------------------------ */

function profileSnapshot(name: string, u: { avatar?: string; color?: string }, s: any) {
  return JSON.stringify([name, u.avatar, u.color, s?.theme ?? null, s?.compact ?? null, s?.animations ?? null]);
}

function scheduleProfilePush(delay = 800) {
  if (!isActive()) return;
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = setTimeout(() => void pushProfile(), delay);
}

async function pushProfile() {
  if (!isActive()) return;
  const owner = uid!;
  const user = await db.users.get(owner);
  if (!user) return;
  const s = await db.settings.get(`user:${owner}`);
  const snap = profileSnapshot(user.name, user, s);
  if (snap === lastProfileSent) return;
  try {
    await remote!.upsertProfile({
      id: owner, display_name: user.name, avatar: user.avatar, color: user.color,
      settings: { theme: s?.theme ?? 'light', compact: !!s?.compact, animations: s?.animations !== false },
    });
    lastProfileSent = snap;
  } catch (e) {
    if (e instanceof RemoteError && e.retryable) scheduleProfilePush(15000);
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

export async function refreshCounts() {
  if (!uid) return set({ pending: 0, failed: 0, conflicts: 0 });
  const owner = uid;
  const all = await db.outbox.where('uid').equals(owner).toArray();
  const conflicts = await db.conflicts.where('uid').equals(owner).count();
  if (owner !== uid) return;
  set({ pending: all.filter((e) => e.state === 'pending').length, failed: all.filter((e) => e.state === 'failed').length, conflicts });
}

export interface StartOptions {
  realtime?: boolean;
  listenToBrowser?: boolean;
}

/** Starts syncing for a signed-in user. Safe to call again for the same user. */
export async function startSync(userId: string, store: RemoteStore, opts: StartOptions = {}) {
  if (uid === userId && remote === store) return;
  stopSync();
  generation++;
  uid = userId;
  remote = store;
  attachSyncHooks(db);
  set({ ...initial, active: true, uid: userId, online: typeof navigator === 'undefined' ? true : navigator.onLine });

  if (opts.listenToBrowser !== false && typeof window !== 'undefined') {
    const onOnline = () => {
      set({ online: true });
      backoff = 2000;
      schedulePush(0);
      void refresh();
    };
    const onOffline = () => set({ online: false, connection: 'offline' });
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - (status.lastPullAt ?? 0) > 20000) void refresh();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const interval = setInterval(() => document.visibilityState === 'visible' && void refresh(), 5 * 60 * 1000);
    cleanup.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(interval);
    });
  }
  if (opts.realtime !== false && store.subscribe) {
    unsubscribeRealtime = store.subscribe(userId, (c) => void onRealtime(c).catch(() => undefined), (s) => set({ realtime: s }));
  }
  await refreshCounts();
  await refresh();
}

/** Stops syncing and forgets everything about the previous user in memory. */
export function stopSync() {
  generation++;
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  cleanup.forEach((f) => f());
  cleanup = [];
  if (retryTimer) clearTimeout(retryTimer);
  if (profileTimer) clearTimeout(profileTimer);
  retryTimer = profileTimer = null;
  uid = null;
  remote = null;
  inflightKey = null;
  inflightSeq = null;
  pushing = false;
  pushAgain = false;
  lastProfileSent = '';
  backoff = 2000;
  set({ ...initial });
}

/** Resolves when the outbox is empty (or the timeout passes). */
export async function waitForIdle(timeoutMs = 5000): Promise<'cloud' | 'pending' | 'error' | 'local'> {
  if (!isActive()) return 'local';
  const owner = uid!;
  const end = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, 150));
    if (uid !== owner) return 'local';
    const pending = await db.outbox.where('uid').equals(owner).toArray();
    const capturingNow = capturing.size > 0;
    if (!pending.length && !capturingNow && !pushing) return status.conflicts ? 'error' : 'cloud';
    if (pending.some((e) => e.state === 'failed')) return 'error';
    if (Date.now() > end || status.connection === 'offline') return 'pending';
  }
}

/** Removes this account's cached records from the device (used on sign-out). */
export async function clearLocalAccountData(owner: string) {
  await asRemote(async () => {
    for (const spec of TABLE_SPECS) await db.table(spec.local).where('ownerId').equals(owner).delete();
    await db.versions.where('uid').equals(owner).delete();
    await db.settings.delete(`user:${owner}`);
    await db.users.delete(owner);
  });
  await db.transaction('rw', db.outbox, db.conflicts, db.drafts, async () => {
    await db.outbox.where('uid').equals(owner).delete();
    await db.conflicts.where('uid').equals(owner).delete();
    await db.drafts.where('ownerId').equals(owner).delete();
  });
}

/** Number of unsent changes / conflicts for an account (works when sync is stopped). */
export async function unsentFor(owner: string) {
  const [pending, conflicts] = await Promise.all([db.outbox.where('uid').equals(owner).count(), db.conflicts.where('uid').equals(owner).count()]);
  return pending + conflicts;
}
