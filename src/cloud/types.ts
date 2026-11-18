/** Shared types for the cloud (Supabase) sync layer. */

export interface RemoteRow {
  id: string;
  version: number;
  data: Record<string, unknown>;
  updated_at?: string;
}

export interface ProfileRow {
  id: string;
  display_name: string;
  avatar: string;
  color: string;
  settings: Record<string, unknown>;
  version?: number;
  updated_at?: string;
}

/** A local change waiting to be sent to the cloud. */
export interface OutboxEntry {
  seq?: number;
  uid: string;
  key: string; // `${table}:${id}`
  table: string; // local Dexie table name
  rowId: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown> | null;
  state: 'pending' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/** Last server version this device has seen for a record (for conflict detection). */
export interface VersionEntry {
  key: string;
  uid: string;
  version: number;
}

export type ConflictKind = 'modified' | 'remote-deleted' | 'local-delete';

export interface ConflictEntry {
  key: string;
  uid: string;
  table: string;
  rowId: string;
  kind: ConflictKind;
  local: Record<string, unknown> | null;
  remote: RemoteRow | null;
  createdAt: number;
}

export type RemoteErrorKind = 'network' | 'server' | 'auth' | 'duplicate' | 'denied' | 'fk' | 'invalid';

export class RemoteError extends Error {
  constructor(public kind: RemoteErrorKind, message: string, public code?: string) {
    super(message);
    this.name = 'RemoteError';
  }
  get retryable() {
    return this.kind === 'network' || this.kind === 'server';
  }
}

export interface RealtimeChange {
  table: string; // remote table name
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  row?: RemoteRow;
  id?: string;
  profile?: ProfileRow;
}

/** Everything the sync engine needs from the server. Implemented with supabase-js; faked in tests. */
export interface RemoteStore {
  fetchAll(table: string, uid: string): Promise<RemoteRow[]>;
  fetchOne(table: string, id: string): Promise<RemoteRow | null>;
  insert(table: string, rows: Record<string, unknown>[]): Promise<RemoteRow[]>;
  /** Returns null when the version no longer matches (or the row is gone). */
  update(table: string, id: string, baseVersion: number, row: Record<string, unknown>): Promise<RemoteRow | null>;
  /** Returns false when the version no longer matches (or the row is gone). */
  remove(table: string, id: string, baseVersion: number): Promise<boolean>;
  getProfile(uid: string): Promise<ProfileRow | null>;
  upsertProfile(row: ProfileRow): Promise<void>;
  subscribe?(uid: string, onChange: (c: RealtimeChange) => void, onStatus: (s: 'connecting' | 'on' | 'error' | 'off') => void): () => void;
}
