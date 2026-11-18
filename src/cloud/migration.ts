/**
 * One-time transfer of records from local 1.0 workspaces (IndexedDB) into the
 * signed-in cloud account.
 *
 * - Local records are COPIED, never deleted (deleting is a separate, confirmed step).
 * - New ids are deterministic: stableUuid(account + local profile + old id), so
 *   running the import again cannot create duplicates.
 * - All links (student, lesson, observation, goal, strategy, subject) are remapped.
 * - Subjects and strategies with the same name as the account's own are merged.
 * - Demo records are skipped unless explicitly requested.
 */
import { db } from '../db/database';
import { OWNER_TABLES, settingsRepo, type OwnerTable } from '../db/repositories';
import type { UserProfile } from '../types/models';
import { stableUuid } from './tables';

export interface LegacyProfile {
  user: UserProfile;
  counts: Partial<Record<OwnerTable, number>>;
  demoCounts: Partial<Record<OwnerTable, number>>;
  total: number;
  demoTotal: number;
  importedTo: { uid: string; at: number }[];
}

export const TABLE_LABELS: Record<OwnerTable, string> = {
  students: 'Учні', subjects: 'Предмети', lessons: 'Уроки', observations: 'Спостереження', tasks: 'Завдання',
  events: 'Події', strategies: 'Стратегії', strategyUses: 'Застосування стратегій', iepGoals: 'Цілі ІПР',
  iepMeasurements: 'Вимірювання ІПР', achievements: 'Досягнення', templates: 'Шаблони',
};

/** Local (non-cloud) workspaces that still hold records. */
export async function findLegacyProfiles(currentUid: string | null): Promise<LegacyProfile[]> {
  const users = await db.users.toArray();
  const app = await settingsRepo.getApp();
  const imports = ((app as any).legacyImports ?? {}) as Record<string, { uid: string; at: number }[]>;
  const out: LegacyProfile[] = [];
  for (const user of users) {
    if (user.id === currentUid || !user.id.startsWith('u_')) continue; // 1.0 profiles have ids "u_<uuid>"
    const counts: LegacyProfile['counts'] = {};
    const demoCounts: LegacyProfile['demoCounts'] = {};
    let total = 0;
    let demoTotal = 0;
    for (const t of OWNER_TABLES) {
      const rows = await db.table(t).where('ownerId').equals(user.id).toArray();
      const demo = rows.filter((r: any) => r.isDemo).length;
      counts[t] = rows.length - demo;
      demoCounts[t] = demo;
      if (t !== 'subjects' && t !== 'strategies') {
        total += rows.length - demo;
        demoTotal += demo;
      }
    }
    if (total + demoTotal === 0) continue;
    out.push({ user, counts, demoCounts, total, demoTotal, importedTo: imports[user.id] ?? [] });
  }
  return out;
}

export interface ImportResult {
  copied: Partial<Record<OwnerTable, number>>;
  skippedExisting: number;
  mergedSubjects: number;
  mergedStrategies: number;
  idMap: Map<string, string>;
}

const ORDER: OwnerTable[] = ['students', 'subjects', 'strategies', 'templates', 'lessons', 'observations', 'tasks', 'events', 'strategyUses', 'iepGoals', 'iepMeasurements', 'achievements'];

/** Copies a local workspace into the cloud account (the sync engine uploads the copies). */
export async function importLegacyProfile(fromOwner: string, toUid: string, opts: { includeDemo: boolean }): Promise<ImportResult> {
  const result: ImportResult = { copied: {}, skippedExisting: 0, mergedSubjects: 0, mergedStrategies: 0, idMap: new Map() };
  const map = result.idMap;
  const source: Record<string, any[]> = {};
  for (const t of ORDER) {
    source[t] = (await db.table(t).where('ownerId').equals(fromOwner).toArray()).filter((r: any) => opts.includeDemo || !r.isDemo);
  }

  // Merge subjects / strategies with the same name; everything else gets a stable new id.
  const norm = (s: string) => s.trim().toLowerCase();
  const ownSubjects = await db.subjects.where('ownerId').equals(toUid).toArray();
  const ownStrategies = await db.strategies.where('ownerId').equals(toUid).toArray();
  for (const s of source.subjects) {
    const same = ownSubjects.find((x) => norm(x.name) === norm(s.name));
    if (same) {
      map.set(s.id, same.id);
      result.mergedSubjects++;
    }
  }
  for (const s of source.strategies) {
    const same = ownStrategies.find((x) => norm(x.name) === norm(s.name));
    if (same) {
      map.set(s.id, same.id);
      result.mergedStrategies++;
    }
  }
  for (const t of ORDER) for (const r of source[t]) if (!map.has(r.id)) map.set(r.id, await stableUuid(`${toUid}:import:${fromOwner}:${r.id}`));

  const m = (id: unknown) => (typeof id === 'string' && map.has(id) ? map.get(id)! : id);
  const remap = (t: OwnerTable, r: any) => {
    const x: any = { ...r, id: map.get(r.id), ownerId: toUid };
    delete x.isDemo;
    for (const f of ['studentId', 'subjectId', 'lessonId', 'observationId', 'goalId', 'strategyId']) if (f in x && x[f]) x[f] = m(x[f]);
    if (Array.isArray(x.strategyIds)) x.strategyIds = x.strategyIds.map(m);
    if (Array.isArray(x.linkedObservationIds)) x.linkedObservationIds = x.linkedObservationIds.map(m);
    if (t === 'templates') x.key = m(x.key);
    if (t === 'students' && r.isDemo) x.name = `${r.name} (демо, імпорт)`;
    return x;
  };

  const ownIds = new Set([...ownSubjects, ...ownStrategies].map((x) => x.id));
  await db.transaction('rw', ORDER.map((t) => db.table(t)), async () => {
    for (const t of ORDER) {
      let n = 0;
      for (const r of source[t]) {
        const newId = map.get(r.id)!;
        if (ownIds.has(newId)) continue; // merged into an existing subject/strategy
        if (await db.table(t).get(newId)) {
          result.skippedExisting++;
          continue; // already imported earlier
        }
        await db.table(t).add(remap(t, r));
        n++;
      }
      result.copied[t] = n;
    }
  });

  const app = await settingsRepo.getApp();
  const imports = { ...((app as any).legacyImports ?? {}) } as Record<string, { uid: string; at: number }[]>;
  imports[fromOwner] = [...(imports[fromOwner] ?? []).filter((x) => x.uid !== toUid), { uid: toUid, at: Date.now() }];
  await settingsRepo.setApp({ legacyImports: imports } as any);
  return result;
}

/** After upload + refresh: every copied record must be present locally from the cloud. */
export async function verifyImport(toUid: string, idMap: Map<string, string>): Promise<{ ok: boolean; missing: number }> {
  const wanted = new Set(idMap.values());
  let found = 0;
  for (const t of ORDER) {
    const ids = (await db.table(t).where('ownerId').equals(toUid).primaryKeys()) as string[];
    for (const id of ids) if (wanted.has(id)) found++;
  }
  const versions = await db.versions.where('uid').equals(toUid).toArray();
  const synced = new Set(versions.map((v) => v.key.split(':')[1]));
  const missing = [...wanted].filter((id) => !synced.has(id)).length;
  return { ok: missing === 0 && found >= wanted.size, missing };
}
