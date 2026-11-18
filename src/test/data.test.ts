import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbInstance, db } from '../db/database';
import { usersRepo, studentsRepo, subjectsRepo, observationsRepo, emptyObservation, emptyStudent, draftsRepo, checkIntegrity } from '../db/repositories';
import { buildBackup, applyBackup, parseBackup, encryptBackup } from '../services/backup';
import { createDemo, clearDemo, hasDemo } from '../services/demo';

let n = 0;
beforeEach(() => { resetDbInstance(`test-${++n}`); });

async function setup() {
  const u = await usersRepo.create('Олена');
  const s = await studentsRepo.save(u.id, { ...emptyStudent(), name: 'Учень А' });
  const subjects = await subjectsRepo.list(u.id);
  return { u, s, subjects };
}

describe('data layer', () => {
  it('creates a profile with default subjects and strategies', async () => {
    const { u, subjects } = await setup();
    expect(subjects.length).toBe(10);
    expect(await db.strategies.where('ownerId').equals(u.id).count()).toBe(11);
  });

  it('creates, edits and deletes an observation with tasks', async () => {
    const { u, s, subjects } = await setup();
    const input = { ...emptyObservation(s.id, subjects[1].id, '2026-11-10'), lessonNumber: 2, behaviors: ['calm', 'interested'],
      tasks: [{ type: 'written', title: 'Слова', offered: 5, completed: 3, unit: 'слів', support: 'verbal', participation: 'active', result: 'partial', comment: '' }], events: [] };
    const o = await observationsRepo.save(u.id, input);
    expect((await observationsRepo.tasksFor(o.id)).length).toBe(1);
    expect(o.lessonId).toBeTruthy();
    const full = await observationsRepo.loadFull(o.id);
    await observationsRepo.save(u.id, { ...full!, topic: 'Нова тема', tasks: [] });
    expect((await observationsRepo.get(o.id))!.topic).toBe('Нова тема');
    expect((await observationsRepo.tasksFor(o.id)).length).toBe(0);
    const dup = await observationsRepo.duplicate(u.id, o.id);
    expect(dup!.id).not.toBe(o.id);
    expect(dup!.status).toBe('draft');
    await observationsRepo.remove(o.id);
    expect(await observationsRepo.get(o.id)).toBeUndefined();
  });

  it('saves and restores drafts', async () => {
    const { u } = await setup();
    await draftsRepo.put(u.id, 'new:x', { topic: 'abc' });
    expect(((await draftsRepo.get('new:x'))!.data as any).topic).toBe('abc');
    await draftsRepo.remove('new:x');
    expect(await draftsRepo.get('new:x')).toBeUndefined();
  });

  it('keeps profiles separated', async () => {
    const a = await setup();
    const b = await usersRepo.create('Ігор');
    expect((await studentsRepo.list(b.id)).length).toBe(0);
    expect((await studentsRepo.list(a.u.id)).length).toBe(1);
    await usersRepo.remove(a.u.id);
    expect(await db.students.count()).toBe(0);
    expect(await db.subjects.where('ownerId').equals(b.id).count()).toBe(10);
  });

  it('exports and imports (merge, replace, encrypted)', async () => {
    const { u, s, subjects } = await setup();
    await observationsRepo.save(u.id, { ...emptyObservation(s.id, subjects[0].id), tasks: [], events: [] });
    const backup = await buildBackup(u.id);
    const text = JSON.stringify(backup);
    const parsed = await parseBackup(text);
    expect(parsed.status).toBe('ok');

    const tampered = JSON.parse(text);
    tampered.data.students[0].name = 'Інше';
    expect((await parseBackup(JSON.stringify(tampered))).status).toBe('error');

    const other = await usersRepo.create('Інший');
    if (parsed.status !== 'ok') throw new Error();
    const res = await applyBackup(other.id, parsed.backup, 'merge');
    expect(res.conflicts).toBeGreaterThan(0); // same IDs belong to first profile

    await db.observations.clear();
    const r2 = await applyBackup(u.id, parsed.backup, 'merge');
    expect(r2.perTable.observations.added).toBe(1);

    const r3 = await applyBackup(u.id, parsed.backup, 'replace');
    expect(r3.added).toBeGreaterThan(0);
    expect(await db.observations.where('ownerId').equals(u.id).count()).toBe(1);

    const encd = await encryptBackup(backup, 'secret-1');
    expect((await parseBackup(JSON.stringify(encd))).status).toBe('needs-password');
    expect((await parseBackup(JSON.stringify(encd), 'wrong')).status).toBe('error');
    expect((await parseBackup(JSON.stringify(encd), 'secret-1')).status).toBe('ok');
  });

  it('demo data is flagged and removable without touching real data', async () => {
    const { u } = await setup();
    await createDemo(u.id, 3);
    expect(await hasDemo(u.id)).toBe(true);
    expect(await db.observations.filter((o) => !!o.isDemo).count()).toBeGreaterThan(10);
    const integ = await checkIntegrity(u.id);
    expect(integ.problems).toEqual([]);
    await clearDemo(u.id);
    expect(await hasDemo(u.id)).toBe(false);
    expect(await db.observations.count()).toBe(0);
    expect((await studentsRepo.list(u.id)).length).toBe(1);
  });

  it('runs schema migrations on an existing v1 database', async () => {
    const Dexie = (await import('dexie')).default;
    const name = `mig-${n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ observations: 'id, ownerId, studentId, [studentId+date], date, subjectId, status' });
    await v1.table('observations').add({ id: 'o1', ownerId: 'u', studentId: 's', date: '2026-01-01' });
    v1.close();
    const d = resetDbInstance(name);
    const o = await d.observations.get('o1');
    expect(o!.status).toBe('final');
    expect(o!.strategyIds).toEqual([]);
  });
});
