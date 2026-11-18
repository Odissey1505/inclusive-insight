import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbInstance, db } from '../db/database';
import { studentsRepo, subjectsRepo, observationsRepo, emptyObservation, emptyStudent, usersRepo, achievementsRepo, iepRepo, emptyGoal, strategiesRepo } from '../db/repositories';
import { startSync, stopSync, waitForIdle, refresh, syncStore, listConflicts, resolveKeepLocal, resolveTakeRemote, clearLocalAccountData } from '../cloud/sync';
import { ensureLocalAccount, seedAccountDefaults } from '../cloud/account';
import { findLegacyProfiles, importLegacyProfile, verifyImport } from '../cloud/migration';
import { createDemo } from '../services/demo';
import { loadDataset } from '../analytics/loader';
import { FakeRemote } from './fakeRemote';

const A = '00000000-0000-4000-8000-0000000000aa';
const B = '00000000-0000-4000-8000-0000000000bb';
let n = 0;

async function device(remote: FakeRemote, uid = A) {
  stopSync();
  resetDbInstance(`sync-${++n}`);
  remote.currentUser = uid;
  await ensureLocalAccount(uid, 'Олена');
  await startSync(uid, remote, { realtime: true, listenToBrowser: false });
  if (syncStore.get().initialPullDone) await seedAccountDefaults(uid);
  await waitForIdle(5000);
}

async function addObservation(uid: string) {
  const s = await studentsRepo.save(uid, { ...emptyStudent(), name: 'Учень А' });
  const subjects = await subjectsRepo.list(uid);
  const o = await observationsRepo.save(uid, {
    ...emptyObservation(s.id, subjects[1].id, '2026-11-10'), lessonNumber: 2, behaviors: ['calm'], engagement: 'active',
    tasks: [{ type: 'written', title: 'Слова', offered: 5, completed: 3, unit: 'слів', support: 'none', participation: 'active', result: 'partial', comment: '' }],
    events: [],
  });
  return { s, o };
}

beforeEach(() => stopSync());
afterEach(() => stopSync());

describe('cloud sync', () => {
  it('uploads local changes with ownership and relation columns', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const { s, o } = await addObservation(A);
    expect(await waitForIdle(5000)).toBe('cloud');
    expect(remote.rows('ii_subjects')).toHaveLength(10);
    expect(remote.rows('ii_strategies')).toHaveLength(11);
    const obs = remote.rows('ii_observations');
    expect(obs).toHaveLength(1);
    expect(obs[0].user_id).toBe(A);
    expect(obs[0].cols.student_id).toBe(s.id);
    expect(obs[0].cols.lesson_id).toBe(o.lessonId);
    expect(obs[0].data.ownerId).toBeUndefined();
    expect(remote.rows('ii_observation_tasks')[0].cols.observation_id).toBe(o.id);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a second device downloads everything; analytics read the same data', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const { s } = await addObservation(A);
    await waitForIdle();
    await device(remote); // "phone": empty IndexedDB
    expect((await studentsRepo.list(A)).map((x) => x.name)).toEqual(['Учень А']);
    expect(await db.subjects.where('ownerId').equals(A).count()).toBe(10); // no duplicate seeding
    const ds = await loadDataset(s.id, { from: '2026-11-01', to: '2026-11-30' });
    expect(ds.observations).toHaveLength(1);
    expect(ds.tasks).toHaveLength(1);
    expect(await db.outbox.count()).toBe(0); // downloads are never echoed back
  });

  it('edits and deletes propagate between devices', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const { o } = await addObservation(A);
    await waitForIdle();
    await device(remote); // phone
    const full = await observationsRepo.loadFull(o.id);
    await observationsRepo.save(A, { ...full!, topic: 'Змінено на телефоні' });
    expect(await waitForIdle()).toBe('cloud');
    expect(remote.rows('ii_observations')[0].data.topic).toBe('Змінено на телефоні');
    expect(remote.rows('ii_observations')[0].version).toBe(2);
    await observationsRepo.remove(o.id);
    expect(await waitForIdle()).toBe('cloud');
    expect(remote.rows('ii_observations')).toHaveLength(0);
    expect(remote.rows('ii_observation_tasks')).toHaveLength(0);
    await device(remote); // laptop again
    expect(await db.observations.where('ownerId').equals(A).count()).toBe(0);
  });

  it('offline changes wait in the queue and are sent when the connection returns', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    remote.offline = true;
    await studentsRepo.save(A, { ...emptyStudent(), name: 'Офлайн' });
    expect(await waitForIdle(1500)).toBe('pending');
    expect(syncStore.get().pending).toBeGreaterThan(0);
    expect(remote.rows('ii_students')).toHaveLength(0);
    remote.offline = false;
    await refresh();
    expect(await waitForIdle(5000)).toBe('cloud');
    expect(remote.rows('ii_students').map((r) => r.data.name)).toEqual(['Офлайн']);
  });

  it('retrying an insert whose response was lost does not create duplicates', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    remote.dropNextInsertResponse = true;
    await studentsRepo.save(A, { ...emptyStudent(), name: 'Один' });
    await waitForIdle(1000);
    await refresh();
    expect(await waitForIdle(8000)).toBe('cloud');
    expect(remote.rows('ii_students')).toHaveLength(1);
    expect(await db.students.where('ownerId').equals(A).count()).toBe(1);
  });

  it('concurrent edits create a conflict instead of silently overwriting', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const s = await studentsRepo.save(A, { ...emptyStudent(), name: 'Учень' });
    await waitForIdle();
    remote.offline = true;
    await studentsRepo.save(A, { ...(await studentsRepo.get(s.id))!, notes: 'з ноутбука' });
    remote.editDirect('ii_students', s.id, { notes: 'з телефону' }); // other device, meanwhile
    remote.offline = false;
    await refresh();
    await waitForIdle(5000);
    const conflicts = await listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('modified');
    expect(remote.rows('ii_students')[0].data.notes).toBe('з телефону'); // nothing overwritten yet
    expect((await studentsRepo.get(s.id))!.notes).toBe('з ноутбука'); // local edit kept for the user to decide

    await resolveKeepLocal(conflicts[0].key);
    expect(await waitForIdle(5000)).toBe('cloud');
    expect(remote.rows('ii_students')[0].data.notes).toBe('з ноутбука');
    expect(remote.rows('ii_students')[0].version).toBe(3);
  });

  it('a conflict can be resolved by taking the cloud version', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const s = await studentsRepo.save(A, { ...emptyStudent(), name: 'Учень' });
    await waitForIdle();
    remote.offline = true;
    await studentsRepo.save(A, { ...(await studentsRepo.get(s.id))!, notes: 'локально' });
    remote.editDirect('ii_students', s.id, { notes: 'хмара' });
    remote.offline = false;
    await refresh();
    await waitForIdle(5000);
    const [c] = await listConflicts();
    await resolveTakeRemote(c.key);
    expect((await studentsRepo.get(s.id))!.notes).toBe('хмара');
    expect(await listConflicts()).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('realtime changes update the local copy without echo loops', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const s = await studentsRepo.save(A, { ...emptyStudent(), name: 'Учень' });
    await waitForIdle();
    const row = remote.editDirect('ii_students', s.id, { name: 'Перейменовано' });
    remote.emit({ table: 'ii_students', type: 'UPDATE', row });
    await new Promise((r) => setTimeout(r, 200));
    expect((await studentsRepo.get(s.id))!.name).toBe('Перейменовано');
    expect(await db.outbox.count()).toBe(0);
    const calls = remote.calls;
    await new Promise((r) => setTimeout(r, 400));
    expect(remote.calls).toBe(calls); // nothing was pushed back
    remote.emit({ table: 'ii_students', type: 'DELETE', id: s.id });
    await new Promise((r) => setTimeout(r, 200));
    expect(await studentsRepo.get(s.id)).toBeUndefined();
  });

  it('demo data stays on the device', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    await createDemo(A);
    await waitForIdle(5000);
    expect(remote.rows('ii_students')).toHaveLength(0);
    expect(remote.rows('ii_observations')).toHaveLength(0);
    await refresh(); // a refresh must not delete local demo data
    expect(await db.students.where('ownerId').equals(A).count()).toBe(1);
  });

  it('accounts are isolated; sign-out can clear the cached copy', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    await addObservation(A);
    await waitForIdle();
    stopSync();
    remote.currentUser = B;
    await ensureLocalAccount(B, 'Ігор');
    await startSync(B, remote, { realtime: false, listenToBrowser: false });
    await seedAccountDefaults(B);
    await waitForIdle();
    expect(await studentsRepo.list(B)).toHaveLength(0);
    expect(remote.rows('ii_students').every((r) => r.user_id === A)).toBe(true);
    await clearLocalAccountData(A);
    expect(await db.students.where('ownerId').equals(A).count()).toBe(0);
    expect(await db.users.get(A)).toBeUndefined();
  });

  it('IEP goals, achievements and strategy uses are synced with their links', async () => {
    const remote = new FakeRemote(A);
    await device(remote);
    const { s, o } = await addObservation(A);
    const g = await iepRepo.saveGoal(A, { ...emptyGoal(s.id), title: 'Ціль', linkedObservationIds: [o.id] });
    await iepRepo.saveMeasurement(A, { studentId: s.id, goalId: g.id, date: '2026-11-11', value: 3, comment: '', criterionMet: false, observationId: o.id });
    await achievementsRepo.save(A, { studentId: s.id, date: '2026-11-12', category: 'communication', title: 'Попросив допомогу', description: '', goalId: g.id, includeInReports: true });
    const strat = (await strategiesRepo.list(A))[0];
    await strategiesRepo.addManualUse(A, { studentId: s.id, strategyId: strat.id, date: '2026-11-12', result: 'helped', comment: '' });
    expect(await waitForIdle(5000)).toBe('cloud');
    expect(remote.rows('ii_iep_measurements')[0].cols.goal_id).toBe(g.id);
    expect(remote.rows('ii_achievements')[0].cols.goal_id).toBe(g.id);
    expect(remote.rows('ii_strategy_uses')[0].cols.strategy_id).toBe(strat.id);
  });
});

describe('import of local 1.0 records', () => {
  it('copies a local workspace once, remaps links, skips demo, keeps the originals', async () => {
    const remote = new FakeRemote(A);
    stopSync();
    resetDbInstance(`import-${++n}`);
    // A 1.0 local workspace with real + demo data
    const local = await usersRepo.create('Олена (локально)');
    const s = await studentsRepo.save(local.id, { ...emptyStudent(), name: 'Учень Л' });
    const subj = await subjectsRepo.list(local.id);
    await observationsRepo.save(local.id, { ...emptyObservation(s.id, subj[0].id, '2026-10-01'), lessonNumber: 1,
      tasks: [{ type: 'written', title: 'Т', offered: 2, completed: 2, unit: 'слів', support: 'none', participation: 'active', result: 'full', comment: '' }], events: [] });
    await createDemo(local.id);

    remote.currentUser = A;
    await ensureLocalAccount(A, 'Олена');
    await startSync(A, remote, { realtime: false, listenToBrowser: false });
    await seedAccountDefaults(A);
    await waitForIdle();

    const legacy = await findLegacyProfiles(A);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].counts.students).toBe(1);
    expect(legacy[0].demoCounts.students).toBe(1);

    const r1 = await importLegacyProfile(local.id, A, { includeDemo: false });
    expect(r1.copied.students).toBe(1);
    expect(r1.copied.subjects).toBe(0); // merged by name with the account's subjects
    expect(r1.mergedSubjects).toBe(10);
    expect(await waitForIdle(8000)).toBe('cloud');
    await refresh();
    expect((await verifyImport(A, r1.idMap)).ok).toBe(true);

    const cloudObs = remote.rows('ii_observations');
    expect(cloudObs).toHaveLength(1);
    const cloudStudent = remote.rows('ii_students')[0];
    expect(cloudObs[0].cols.student_id).toBe(cloudStudent.id);
    expect(remote.rows('ii_observation_tasks')[0].cols.observation_id).toBe(cloudObs[0].id);
    expect(remote.rows('ii_students').some((x) => x.data.name.includes('демо'))).toBe(false);

    // running the import again creates no duplicates
    const r2 = await importLegacyProfile(local.id, A, { includeDemo: false });
    expect(r2.skippedExisting).toBeGreaterThan(0);
    await waitForIdle(5000);
    expect(remote.rows('ii_observations')).toHaveLength(1);
    expect(remote.rows('ii_students')).toHaveLength(1);

    // originals are untouched
    expect(await db.observations.where('ownerId').equals(local.id).count()).toBeGreaterThan(1);
    expect((await findLegacyProfiles(A))[0].importedTo[0].uid).toBe(A);
  });
});
