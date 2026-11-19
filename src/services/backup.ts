import { db, SCHEMA_VERSION } from '../db/database';
import { OWNER_TABLES, type OwnerTable } from '../db/repositories';
import type { ID } from '../types/models';

export const BACKUP_APP = 'inclusive-insight';
export const BACKUP_FORMAT = 1;
export const APP_VERSION = '1.2.0';

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  profile: { name: string; avatar?: string };
  counts: Record<string, number>;
  data: Partial<Record<OwnerTable, any[]>>;
  checksum: string;
}

export interface EncryptedBackup {
  app: typeof BACKUP_APP;
  format: number;
  encrypted: true;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  payload: string;
}

/* ---------------- crypto helpers (Web Crypto API) ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(backup: BackupFile, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250_000;
  const key = await deriveKey(password, salt, iterations);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(backup)));
  return {
    app: BACKUP_APP, format: BACKUP_FORMAT, encrypted: true, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256',
    iterations, salt: toB64(salt), iv: toB64(iv), payload: toB64(cipher),
  };
}

export async function decryptBackup(env: EncryptedBackup, password: string): Promise<unknown> {
  const key = await deriveKey(password, fromB64(env.salt), env.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.payload) as BufferSource);
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error('Неправильний пароль або пошкоджений файл.');
  }
}

/* ---------------- export ---------------- */

export async function buildBackup(ownerId: ID): Promise<BackupFile> {
  const user = await db.users.get(ownerId);
  const data: Partial<Record<OwnerTable, any[]>> = {};
  const counts: Record<string, number> = {};
  for (const t of OWNER_TABLES) {
    const rows = await db.table(t).where('ownerId').equals(ownerId).toArray();
    data[t] = rows;
    counts[t] = rows.length;
  }
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: { name: user?.name ?? '', avatar: user?.avatar },
    counts,
    data,
    checksum: await sha256(JSON.stringify(data)),
  };
}

/* ---------------- import: parse & validate ---------------- */

export type ParseResult =
  | { status: 'needs-password'; envelope: EncryptedBackup }
  | { status: 'ok'; backup: BackupFile; warnings: string[] }
  | { status: 'error'; errors: string[] };

export function isEncrypted(x: any): x is EncryptedBackup {
  return x && x.app === BACKUP_APP && x.encrypted === true && typeof x.payload === 'string';
}

export async function parseBackup(text: string, password?: string): Promise<ParseResult> {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'error', errors: ['Файл не є коректним JSON.'] };
  }
  if (isEncrypted(raw)) {
    if (!password) return { status: 'needs-password', envelope: raw };
    try {
      raw = await decryptBackup(raw, password);
    } catch (e) {
      return { status: 'error', errors: [(e as Error).message] };
    }
  }
  return validateBackup(raw);
}

export async function validateBackup(raw: any): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { status: 'error', errors: ['Порожній або невідомий файл.'] };
  if (raw.app !== BACKUP_APP) errors.push('Це не резервна копія Inclusive Insight.');
  if (typeof raw.format !== 'number' || raw.format > BACKUP_FORMAT) errors.push(`Непідтримувана версія формату файлу (${raw.format}).`);
  if (typeof raw.schemaVersion !== 'number') errors.push('Не вказано версію схеми бази.');
  else if (raw.schemaVersion > SCHEMA_VERSION) errors.push(`Файл створено новішою версією додатка (схема ${raw.schemaVersion}). Оновіть додаток.`);
  else if (raw.schemaVersion < SCHEMA_VERSION) warnings.push(`Файл має старішу схему (${raw.schemaVersion}); дані буде адаптовано.`);
  if (!raw.data || typeof raw.data !== 'object') errors.push('Відсутній розділ даних.');
  if (errors.length) return { status: 'error', errors };

  for (const [table, rows] of Object.entries(raw.data)) {
    if (!(OWNER_TABLES as readonly string[]).includes(table)) {
      warnings.push(`Невідома таблиця «${table}» буде пропущена.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`Таблиця «${table}» має неправильну структуру.`);
      continue;
    }
    const bad = (rows as any[]).filter((r) => !r || typeof r.id !== 'string' || !r.id);
    if (bad.length) errors.push(`Таблиця «${table}»: ${bad.length} запис(ів) без ID.`);
    const ids = new Set<string>();
    let dup = 0;
    for (const r of rows as any[]) {
      if (ids.has(r.id)) dup++;
      ids.add(r.id);
    }
    if (dup) warnings.push(`Таблиця «${table}»: ${dup} дублікатів ID у файлі — буде збережено останній.`);
  }
  if (typeof raw.checksum === 'string') {
    const actual = await sha256(JSON.stringify(raw.data));
    if (actual !== raw.checksum) errors.push('Контрольна сума не збігається: файл змінено або пошкоджено.');
  } else {
    warnings.push('Файл не містить контрольної суми — цілісність не перевірено.');
  }
  if (errors.length) return { status: 'error', errors };
  return { status: 'ok', backup: raw as BackupFile, warnings };
}

/* ---------------- import: apply ---------------- */

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  conflicts: number;
  perTable: Record<string, { added: number; updated: number; skipped: number }>;
}

/**
 * mode "replace": wipes this profile's data, then writes the backup.
 * mode "merge": records with new IDs are added; same ID → the newer updatedAt wins.
 * All imported records are re-owned by the current profile.
 */
export async function applyBackup(ownerId: ID, backup: BackupFile, mode: 'merge' | 'replace'): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, conflicts: 0, perTable: {} };
  const tables = OWNER_TABLES.map((t) => db.table(t));
  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') {
      for (const t of OWNER_TABLES) await db.table(t).where('ownerId').equals(ownerId).delete();
    }
    for (const t of OWNER_TABLES) {
      const rows = (backup.data[t] ?? []) as any[];
      const stats = { added: 0, updated: 0, skipped: 0 };
      const byId = new Map<string, any>();
      for (const r of rows) byId.set(r.id, r);
      for (const r of byId.values()) {
        const rec = { ...r, ownerId };
        normalise(t, rec);
        const existing = await db.table(t).get(rec.id);
        if (!existing) {
          await db.table(t).add(rec);
          stats.added++;
        } else if (existing.ownerId !== ownerId) {
          result.conflicts++;
          stats.skipped++;
        } else if ((rec.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          await db.table(t).put(rec);
          stats.updated++;
        } else {
          stats.skipped++;
        }
      }
      result.perTable[t] = stats;
      result.added += stats.added;
      result.updated += stats.updated;
      result.skipped += stats.skipped;
    }
  });
  return result;
}

/** Fills fields added in later schema versions so older backups stay usable. */
function normalise(table: string, r: any) {
  r.createdAt ??= Date.now();
  r.updatedAt ??= r.createdAt;
  if (table === 'observations') {
    r.status ??= 'final';
    r.interactions ??= {};
    r.strategyIds ??= [];
    r.behaviors ??= [];
    r.communication ??= [];
    r.motivation ??= [];
    r.supportLevels ??= [];
    r.subjectFields ??= {};
    r.context ??= { before: '', action: '', after: '', support: '', result: '' };
  }
  if (table === 'iepGoals') r.linkedObservationIds ??= [];
}

export function backupPreview(b: BackupFile) {
  const students = (b.data.students ?? []).map((s: any) => s.name as string);
  const obs = (b.data.observations ?? []) as any[];
  const dates = obs.map((o) => o.date as string).filter(Boolean).sort();
  return {
    profile: b.profile?.name,
    exportedAt: b.exportedAt,
    schemaVersion: b.schemaVersion,
    students,
    observations: obs.length,
    from: dates[0],
    to: dates[dates.length - 1],
    counts: Object.fromEntries(OWNER_TABLES.map((t) => [t, (b.data[t] ?? []).length])),
  };
}
