/** In-memory stand-in for Supabase with the same version / ownership semantics as the SQL migration. */
import { RemoteError, type ProfileRow, type RealtimeChange, type RemoteRow, type RemoteStore } from '../cloud/types';

interface Stored { id: string; user_id: string; version: number; data: any; cols: Record<string, unknown> }

export class FakeRemote implements RemoteStore {
  tables = new Map<string, Map<string, Stored>>();
  profiles = new Map<string, ProfileRow>();
  offline = false;
  /** Perform the next insert but lose the response (simulates a dropped connection). */
  dropNextInsertResponse = false;
  calls = 0;
  private handlers: ((c: RealtimeChange) => void)[] = [];

  constructor(public currentUser: string) {}
  private t(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }
  private guard() {
    this.calls++;
    if (this.offline) throw new RemoteError('network', 'offline');
  }
  private visible(s: Stored | undefined) {
    return s && s.user_id === this.currentUser ? s : undefined;
  }
  private out(s: Stored): RemoteRow {
    return { id: s.id, version: s.version, data: JSON.parse(JSON.stringify(s.data)) };
  }
  async fetchAll(table: string, uid: string) {
    this.guard();
    return [...this.t(table).values()].filter((s) => s.user_id === uid && s.user_id === this.currentUser).map((s) => this.out(s));
  }
  async fetchOne(table: string, id: string) {
    this.guard();
    const s = this.visible(this.t(table).get(id));
    return s ? this.out(s) : null;
  }
  async insert(table: string, rows: Record<string, any>[]) {
    this.guard();
    const t = this.t(table);
    for (const r of rows) {
      if (r.user_id !== this.currentUser) throw new RemoteError('denied', 'rls');
      if (t.has(r.id)) throw new RemoteError('duplicate', 'dup', '23505');
    }
    const created = rows.map((r) => {
      const { id, user_id, data, ...cols } = r;
      const s: Stored = { id, user_id, data, cols, version: 1 };
      t.set(id, s);
      return this.out(s);
    });
    if (this.dropNextInsertResponse) {
      this.dropNextInsertResponse = false;
      throw new RemoteError('network', 'response lost');
    }
    return created;
  }
  async update(table: string, id: string, baseVersion: number, row: Record<string, any>) {
    this.guard();
    const s = this.visible(this.t(table).get(id));
    if (!s || s.version !== baseVersion) return null;
    const { id: _i, user_id: _u, data, ...cols } = row;
    s.data = data;
    s.cols = cols;
    s.version++;
    return this.out(s);
  }
  async remove(table: string, id: string, baseVersion: number) {
    this.guard();
    const s = this.visible(this.t(table).get(id));
    if (!s || s.version !== baseVersion) return false;
    this.t(table).delete(id);
    return true;
  }
  async getProfile(uid: string) {
    this.guard();
    return uid === this.currentUser ? this.profiles.get(uid) ?? null : null;
  }
  async upsertProfile(row: ProfileRow) {
    this.guard();
    this.profiles.set(row.id, row);
  }
  subscribe(_uid: string, onChange: (c: RealtimeChange) => void, onStatus: (s: any) => void) {
    this.handlers.push(onChange);
    onStatus('on');
    return () => {
      this.handlers = this.handlers.filter((h) => h !== onChange);
    };
  }
  emit(c: RealtimeChange) {
    this.handlers.forEach((h) => h(c));
  }
  /** Simulates another device editing a record directly in the cloud. */
  editDirect(table: string, id: string, patch: Record<string, unknown>) {
    const s = this.t(table).get(id)!;
    s.data = { ...s.data, ...patch };
    s.version++;
    return this.out(s);
  }
  rows(table: string) {
    return [...this.t(table).values()];
  }
}
