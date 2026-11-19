import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbInstance, db } from '../db/database';
import { studentsRepo, subjectsRepo, observationsRepo, emptyObservation, emptyStudent, bootstrapOwner } from '../db/repositories';
import {
  isoWeekday, addDaysISO, eachDateISO, localTodayISO, findPeriod, findOverlaps, overlapResolutions, resolveDay, resolveRange,
  journalStats, autoTimes, timeProblem, slotsProblem, planTemplateChange, templateAt, nextLesson, periodProblem, weekStartISO,
  type SlotDraft,
} from '../schedule/scheduleEngine';
import { scheduleRepo, emptyPeriod } from '../schedule/scheduleRepo';
import { startSync, stopSync, waitForIdle } from '../cloud/sync';
import { ensureLocalAccount, seedAccountDefaults } from '../cloud/account';
import { FakeRemote } from './fakeRemote';
import type { Observation, SchedulePeriod, ScheduleSlot, Subject } from '../types/models';

const OWNER = 'u_sched';
let n = 0;
let student: { id: string };
let subj: Record<string, Subject>;

// 2026-11-16 is a Monday
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const SAT = '2026-11-21';

function weekDrafts(): SlotDraft[] {
  const plan: Record<number, string[]> = { 1: ['reading', 'math', 'writing'], 2: ['writing', 'reading', 'math'], 3: ['math', 'art'], 4: ['reading', 'music', 'math'], 5: ['writing', 'pe'] };
  const times = autoTimes('08:30', 5, 35, 10);
  return Object.entries(plan).flatMap(([wd, keys]) => keys.map((k, i) => ({
    weekday: +wd, lessonNumber: i + 1, subjectId: subj[k].id, startTime: times[i].startTime, endTime: times[i].endTime, notes: '',
  })));
}

async function createSemester(name = 'І семестр 2026/2027', start = '2026-09-01', end = '2026-12-31', drafts = weekDrafts()) {
  return scheduleRepo.savePeriod(OWNER, { ...emptyPeriod(student.id, start, end), name, academicYear: '2026/2027' }, drafts);
}
const data = () => scheduleRepo.loadData(student.id, '2026-01-01', '2027-12-31');

beforeEach(async () => {
  stopSync();
  resetDbInstance(`schedule-${++n}`);
  await db.users.put({ id: OWNER, name: 'T', avatar: '', color: '', createdAt: 0, lastActiveAt: 0 });
  await bootstrapOwner(OWNER);
  student = await studentsRepo.save(OWNER, { ...emptyStudent(), name: 'Учень' });
  const list = await subjectsRepo.list(OWNER);
  subj = Object.fromEntries(list.map((s) => [s.templateKey ?? s.name, s]));
});
afterEach(() => stopSync());

describe('calendar dates (time-zone safe)', () => {
  it('weekday and date arithmetic never shift the day', () => {
    expect(isoWeekday(MON)).toBe(1);
    expect(isoWeekday(SAT)).toBe(6);
    expect(isoWeekday('2026-11-22')).toBe(7);
    expect(isoWeekday('2027-03-28')).toBe(7); // EU DST switch day
    expect(addDaysISO('2026-10-24', 2)).toBe('2026-10-26'); // across DST end
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(eachDateISO('2026-10-24', '2026-10-27')).toHaveLength(4);
    expect(weekStartISO(WED)).toBe(MON);
  });
  it('local today uses the local calendar date, not UTC', () => {
    // 00:30 local on 1 Sep: the UTC date would still be 31 Aug in Kyiv
    expect(localTodayISO(new Date(2026, 8, 1, 0, 30))).toBe('2026-09-01');
    expect(localTodayISO(new Date(2026, 8, 1, 23, 59))).toBe('2026-09-01');
  });
});

describe('Smart Schedule', () => {
  it('1–2. creates a weekly template that repeats every week', async () => {
    const p = await createSemester();
    expect(await db.scheduleSlots.where('periodId').equals(p.id).count()).toBe(13); // no record per future lesson
    const d = await data();
    const mon1 = resolveDay(MON, student.id, d);
    const mon2 = resolveDay(addDaysISO(MON, 7), student.id, d);
    const mon10 = resolveDay(addDaysISO(MON, -70), student.id, d);
    for (const day of [mon1, mon2, mon10]) {
      expect(day.state).toBe('ok');
      expect(day.lessons.map((l) => l.subjectId)).toEqual([subj.reading.id, subj.math.id, subj.writing.id]);
      expect(day.lessons[0]).toMatchObject({ number: 1, startTime: '08:30', endTime: '09:05', kind: 'regular', status: 'none' });
    }
    expect(resolveDay(SAT, student.id, d).state).toBe('no-lessons');
  });

  it('3–4. picks the schedule by date and switches between semesters', async () => {
    const s1 = await createSemester();
    const s2drafts = weekDrafts().map((x) => (x.weekday === 1 && x.lessonNumber === 1 ? { ...x, subjectId: subj.art.id } : x));
    const s2 = await createSemester('ІІ семестр 2026/2027', '2027-01-12', '2027-05-31', s2drafts);
    const d = await data();
    expect(findPeriod(d.periods, student.id, '2026-11-15')?.id).toBe(s1.id);
    expect(findPeriod(d.periods, student.id, '2027-02-01')?.id).toBe(s2.id);
    expect(resolveDay('2026-12-28', student.id, d).lessons[0].subjectId).toBe(subj.reading.id); // Mon, semester 1
    expect(resolveDay('2027-01-18', student.id, d).lessons[0].subjectId).toBe(subj.art.id); // Mon, semester 2
  });

  it('16. no schedule for a date → nothing is invented', async () => {
    await createSemester();
    const d = await data();
    const day = resolveDay('2027-01-04', student.id, d); // winter break gap, Monday
    expect(day.state).toBe('no-period');
    expect(day.lessons).toEqual([]);
  });

  it('17. overlapping main schedules are detected and can be resolved', async () => {
    const s1 = await createSemester();
    const d = await data();
    const candidate = { id: 'new', studentId: student.id, startDate: '2026-12-15', endDate: '2027-05-31', archived: false };
    const over = findOverlaps(d.periods, candidate);
    expect(over.map((p) => p.id)).toEqual([s1.id]);
    const fixes = overlapResolutions(over[0], candidate);
    expect(fixes.find((f) => f.kind === 'trim-existing')).toMatchObject({ startDate: '2026-09-01', endDate: '2026-12-14' });
    expect(fixes.find((f) => f.kind === 'move-new')).toMatchObject({ startDate: '2027-01-01', endDate: '2027-05-31' });
    expect(findOverlaps(d.periods, { ...candidate, startDate: '2027-01-01' })).toEqual([]);
    expect(findOverlaps(d.periods, { ...candidate, studentId: 'other' })).toEqual([]);
    expect(findOverlaps([{ ...s1, archived: true }], candidate)).toEqual([]);
  });

  it('5. replaces one lesson on one date only', async () => {
    const p = await createSemester();
    const slots = await scheduleRepo.listSlots(student.id);
    const tue3 = slots.find((s) => s.weekday === 2 && s.lessonNumber === 3)!; // maths
    await scheduleRepo.setSlotOverride(OWNER, p, tue3, TUE, { subjectId: subj.reading.id });
    const d = await data();
    const day = resolveDay(TUE, student.id, d);
    expect(day.lessons[2]).toMatchObject({ subjectId: subj.reading.id, kind: 'changed', changes: ['subject'] });
    expect(day.lessons[2].scheduled?.subjectId).toBe(subj.math.id);
    expect(resolveDay(addDaysISO(TUE, 7), student.id, d).lessons[2].subjectId).toBe(subj.math.id); // other Tuesdays untouched
    // the template itself is unchanged
    expect((await db.scheduleSlots.get(tue3.id))!.subjectId).toBe(subj.math.id);
    // setting it back removes the exception
    await scheduleRepo.setSlotOverride(OWNER, p, tue3, TUE, { subjectId: subj.math.id });
    expect(await db.scheduleOverrides.count()).toBe(0);
  });

  it('6. cancels a lesson; the same exception is never duplicated', async () => {
    const p = await createSemester();
    const mon1 = (await scheduleRepo.listSlots(student.id)).find((s) => s.weekday === 1 && s.lessonNumber === 1)!;
    await scheduleRepo.setSlotOverride(OWNER, p, mon1, MON, { cancelled: true });
    await scheduleRepo.setSlotOverride(OWNER, p, mon1, MON, { cancelled: true, note: 'екскурсія' });
    expect(await db.scheduleOverrides.count()).toBe(1);
    const day = resolveDay(MON, student.id, await data());
    expect(day.lessons[0]).toMatchObject({ kind: 'cancelled', status: 'cancelled', cancelled: true, note: 'екскурсія' });
  });

  it('7–8. adds an extra lesson and changes a lesson time', async () => {
    const p = await createSemester();
    const wed2 = (await scheduleRepo.listSlots(student.id)).find((s) => s.weekday === 3 && s.lessonNumber === 2)!;
    await scheduleRepo.addExtra(OWNER, p, WED, { subjectId: subj.english.id, lessonNumber: 3, startTime: '10:30', endTime: '11:05' });
    await scheduleRepo.setSlotOverride(OWNER, p, wed2, WED, { startTime: '09:30', endTime: '10:05' });
    const day = resolveDay(WED, student.id, await data());
    expect(day.lessons.map((l) => [l.number, l.kind])).toEqual([[1, 'regular'], [2, 'changed'], [3, 'extra']]);
    expect(day.lessons[1]).toMatchObject({ startTime: '09:30', endTime: '10:05', changes: ['time'] });
    expect(day.lessons[2]).toMatchObject({ subjectId: subj.english.id, startTime: '10:30' });
  });

  it('change of order on one day (numbers swapped)', async () => {
    const p = await createSemester();
    const s = (await scheduleRepo.listSlots(student.id)).filter((x) => x.weekday === 1);
    await scheduleRepo.setSlotOverride(OWNER, p, s.find((x) => x.lessonNumber === 1)!, MON, { lessonNumber: 2 });
    await scheduleRepo.setSlotOverride(OWNER, p, s.find((x) => x.lessonNumber === 2)!, MON, { lessonNumber: 1 });
    const day = resolveDay(MON, student.id, await data());
    expect(day.lessons.map((l) => l.subjectId)).toEqual([subj.math.id, subj.reading.id, subj.writing.id]);
  });

  it('9. day without lessons and shortened lessons; exceptions can be undone', async () => {
    const p = await createSemester();
    await scheduleRepo.setDay(OWNER, p, MON, { dayOff: 'holiday', reason: 'День Святого Миколая' });
    let day = resolveDay(MON, student.id, await data());
    expect(day.state).toBe('day-off');
    expect(day.lessons).toEqual([]);
    await scheduleRepo.setDay(OWNER, p, TUE, { dayOff: null, shortened: { duration: 30, breakMinutes: 5 } });
    day = resolveDay(TUE, student.id, await data());
    expect(day.lessons.map((l) => l.startTime)).toEqual(['08:30', '09:05', '09:40']);
    expect(day.lessons.every((l) => l.kind === 'changed')).toBe(true);
    await scheduleRepo.resetDate(p.id, MON);
    await scheduleRepo.setDay(OWNER, p, TUE, { dayOff: null, shortened: null });
    expect(resolveDay(MON, student.id, await data()).state).toBe('ok');
    expect(resolveDay(TUE, student.id, await data()).lessons[1].startTime).toBe('09:15');
    expect(await db.scheduleOverrides.count()).toBe(0);
  });

  it('10–11. editing the template mid-semester keeps the past and observations', async () => {
    const p = await createSemester();
    // an observation was recorded for Monday lesson 1 (reading) before the change
    const obs = await observationsRepo.save(OWNER, { ...emptyObservation(student.id, subj.reading.id, '2026-11-09'), lessonNumber: 1, startTime: '08:30', endTime: '09:05', tasks: [], events: [] });
    const all = await scheduleRepo.listSlots(student.id);
    const desired: SlotDraft[] = templateAt(p, all, MON).map((s) => (s.weekday === 1 && s.lessonNumber === 1 ? { ...s, subjectId: subj.english.id, startTime: '08:45', endTime: '09:20' } : s));
    await scheduleRepo.savePeriod(OWNER, p, desired, { effectiveDate: MON });
    const d = await data();
    const before = resolveDay('2026-11-09', student.id, d);
    const after = resolveDay(MON, student.id, d);
    expect(before.lessons[0]).toMatchObject({ subjectId: subj.reading.id, startTime: '08:30', status: 'filled' });
    expect(before.lessons[0].observation?.id).toBe(obs.id);
    expect(after.lessons[0]).toMatchObject({ subjectId: subj.english.id, startTime: '08:45', kind: 'regular' });
    expect((await db.observations.get(obs.id))!.subjectId).toBe(subj.reading.id); // never rewritten
    expect(await db.scheduleSlots.count()).toBe(14); // old version kept, one new version
  });

  it('plan: before the semester starts the template is simply replaced', () => {
    const p = { id: 'p', startDate: '2026-09-01', endDate: '2026-12-31' } as SchedulePeriod;
    const cur = [{ id: 'a', periodId: 'p', weekday: 1, lessonNumber: 1, subjectId: 'x', startTime: null, endTime: null, notes: '', effectiveFrom: null, effectiveTo: null }] as ScheduleSlot[];
    const plan = planTemplateChange(p, cur, [{ id: 'a', weekday: 1, lessonNumber: 1, subjectId: 'y', startTime: null, endTime: null, notes: '' }], '2026-09-01', () => 'new');
    expect(plan.versioned).toBe(false);
    expect(plan.updates).toEqual([{ id: 'a', patch: expect.objectContaining({ subjectId: 'y' }) }]);
    expect(plan.inserts).toEqual([]);
  });

  it('exceptions after the effective date follow the new version of the lesson', async () => {
    const p = await createSemester();
    const mon1 = (await scheduleRepo.listSlots(student.id)).find((s) => s.weekday === 1 && s.lessonNumber === 1)!;
    await scheduleRepo.setSlotOverride(OWNER, p, mon1, addDaysISO(MON, 7), { cancelled: true });
    const desired = templateAt(p, await scheduleRepo.listSlots(student.id), MON).map((s) => (s.id === mon1.id ? { ...s, startTime: '08:40', endTime: '09:15' } : s));
    await scheduleRepo.savePeriod(OWNER, p, desired, { effectiveDate: MON });
    const next = resolveDay(addDaysISO(MON, 7), student.id, await data());
    expect(next.lessons[0]).toMatchObject({ cancelled: true, startTime: '08:40' });
    expect(await db.scheduleOverrides.count()).toBe(1);
  });

  it('12. observations attach to their lesson; no duplicates are created', async () => {
    const p = await createSemester();
    const day0 = resolveDay(MON, student.id, await data());
    const l2 = day0.lessons[1];
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, l2.subjectId, MON), lessonNumber: l2.number, scheduleKey: l2.key, periodId: p.id, status: 'draft', tasks: [], events: [] });
    const day = resolveDay(MON, student.id, await data());
    expect(day.lessons).toHaveLength(3);
    expect(day.lessons[1]).toMatchObject({ status: 'draft' });
    // an observation without schedule information still matches by lesson number
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, subj.reading.id, MON), lessonNumber: 1, tasks: [], events: [] });
    const day2 = resolveDay(MON, student.id, await data());
    expect(day2.lessons).toHaveLength(3);
    expect(day2.lessons[0].status).toBe('filled');
    // an observation that does not belong to any lesson is shown, never lost
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, subj.music.id, MON), lessonNumber: 7, tasks: [], events: [] });
    const day3 = resolveDay(MON, student.id, await data());
    // (1.0 behaviour kept: an observation outside the schedule creates a manual lesson record)
    expect(day3.lessons.map((l) => l.kind)).toEqual(['regular', 'regular', 'regular', 'manual']);
    expect(day3.lessons[3].observation?.lessonNumber).toBe(7);
    expect(await db.lessons.where('[studentId+date]').equals([student.id, MON]).count()).toBe(2); // only for non-schedule observations
    expect(nextLesson(day3, day3.lessons[0].key, 1)?.number).toBe(3);
  });

  it('legacy manual lessons merge with scheduled ones by number', async () => {
    await createSemester();
    await db.lessons.add({ id: 'L1', ownerId: OWNER, studentId: student.id, date: MON, number: 1, subjectId: subj.reading.id, topic: 'Літера А', createdAt: 0, updatedAt: 0 });
    await db.lessons.add({ id: 'L9', ownerId: OWNER, studentId: student.id, date: MON, number: 6, subjectId: subj.music.id, topic: '', createdAt: 0, updatedAt: 0 });
    const day = resolveDay(MON, student.id, await data());
    expect(day.lessons[0]).toMatchObject({ lessonId: 'L1', topic: 'Літера А', kind: 'regular' });
    expect(day.lessons.map((l) => l.kind)).toEqual(['regular', 'regular', 'regular', 'manual']);
  });

  it('13. journal-keeping statistics count cancellations and days off and ignore the future', async () => {
    const p = await createSemester();
    const slots = await scheduleRepo.listSlots(student.id);
    const mon = slots.filter((s) => s.weekday === 1).sort((a, b) => a.lessonNumber - b.lessonNumber);
    await scheduleRepo.setSlotOverride(OWNER, p, mon[0], MON, { cancelled: true });
    await scheduleRepo.setSlotOverride(OWNER, p, mon[2], MON, { skipped: true });
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, subj.math.id, MON), lessonNumber: 2, tasks: [], events: [] });
    await scheduleRepo.setDay(OWNER, p, TUE, { dayOff: 'other', reason: 'карантин' });
    const days = resolveRange(MON, '2026-11-22', student.id, await data());
    const s = journalStats(days, WED); // Thu/Fri are in the future
    expect(s).toMatchObject({ planned: 5, cancelled: 1, held: 4, withObservation: 1, withoutObservation: 3, skipped: 1, daysOff: 1 });
    expect(s.fillPct).toBe(25);
    expect(journalStats([], WED).fillPct).toBeNull();
  });

  it('deterministic exception ids are valid UUIDs', async () => {
    const { hashUuid } = await import('../schedule/scheduleRepo');
    expect(hashUuid('a')).toBe(hashUuid('a'));
    expect(hashUuid('a')).not.toBe(hashUuid('b'));
    expect(hashUuid('schedule:x:2026-11-16:slot:y')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('observation without schedule data, saved from a scheduled lesson, does not create a lesson record', async () => {
    const p = await createSemester();
    const l = resolveDay(MON, student.id, await data()).lessons[0];
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, l.subjectId, MON), lessonNumber: 1, scheduleKey: l.key, periodId: p.id, tasks: [], events: [] });
    expect(await db.lessons.count()).toBe(0);
    expect(resolveDay(MON, student.id, await data()).lessons[0].status).toBe('filled');
  });

  it('validation of times, lesson numbers and periods', () => {
    expect(timeProblem('09:00', '08:30')).toMatch(/пізніше/);
    expect(timeProblem('9:00', null)).toMatch(/формат/);
    expect(timeProblem(null, null)).toBeNull();
    expect(slotsProblem([{ weekday: 1, lessonNumber: 1, subjectId: 'a', startTime: null, endTime: null, notes: '' }, { weekday: 1, lessonNumber: 1, subjectId: 'b', startTime: null, endTime: null, notes: '' }])).toMatch(/повторюється/);
    expect(slotsProblem([{ weekday: 2, lessonNumber: 1, subjectId: '', startTime: null, endTime: null, notes: '' }])).toMatch(/предмет/);
    expect(periodProblem({ name: 'x', startDate: '2026-12-31', endDate: '2026-09-01', weekdays: [1] })).toMatch(/Кінцева/);
    expect(autoTimes('08:00', 3, 45, [10, 20])).toEqual([
      { startTime: '08:00', endTime: '08:45' }, { startTime: '08:55', endTime: '09:40' }, { startTime: '10:00', endTime: '10:45' },
    ]);
  });

  it('deleting a schedule keeps observations; archived schedules are not active', async () => {
    const p = await createSemester();
    await observationsRepo.save(OWNER, { ...emptyObservation(student.id, subj.reading.id, MON), lessonNumber: 1, tasks: [], events: [] });
    expect(await scheduleRepo.linkedObservationCount(p)).toBe(1);
    await scheduleRepo.setArchived(p.id, true);
    expect(resolveDay(MON, student.id, await data()).state).toBe('ok'); // only the observation remains
    expect(resolveDay(MON, student.id, await data()).lessons.map((l) => [l.kind, l.status])).toEqual([['manual', 'filled']]);
    await scheduleRepo.deletePeriod(p.id);
    expect(await db.scheduleSlots.count()).toBe(0);
    expect(await db.observations.count()).toBe(1);
  });

  it('"create based on previous" copies the weekly template', async () => {
    const s1 = await createSemester();
    const copy = await scheduleRepo.templateOf(s1.id);
    expect(copy).toHaveLength(13);
    const s2 = await createSemester('ІІ семестр', '2027-01-12', '2027-05-31', copy);
    expect(await db.scheduleSlots.where('periodId').equals(s2.id).count()).toBe(13);
    expect(await db.scheduleSlots.where('periodId').equals(s1.id).count()).toBe(13); // old one kept for history
  });
});

describe('backups with Smart Schedule', () => {
  it('schedule is included in backups, and old 1.1 backups without it still import', async () => {
    const { buildBackup, validateBackup, applyBackup, sha256 } = await import('../services/backup');
    await createSemester();
    const b = await buildBackup(OWNER);
    expect((b.data as any).schedulePeriods).toHaveLength(1);
    expect((b.data as any).scheduleSlots).toHaveLength(13);
    // a backup made by 1.1 (schema 3) has no schedule tables
    const old: any = JSON.parse(JSON.stringify(b));
    delete old.data.schedulePeriods; delete old.data.scheduleSlots; delete old.data.scheduleOverrides;
    old.schemaVersion = 3;
    old.checksum = await sha256(JSON.stringify(old.data));
    const v = await validateBackup(old);
    expect(v.status).toBe('ok');
    await applyBackup(OWNER, old, 'merge');
    expect(await db.scheduleSlots.count()).toBe(13); // merge keeps the existing schedule
  });
});

describe('14. Smart Schedule sync between devices', () => {
  it('a schedule and its exceptions created on one device appear on another', async () => {
    const A = '00000000-0000-4000-8000-0000000000a1';
    const remote = new FakeRemote(A);
    resetDbInstance(`sched-sync-1-${++n}`);
    await ensureLocalAccount(A, 'A');
    await startSync(A, remote, { realtime: false, listenToBrowser: false });
    await seedAccountDefaults(A);
    await waitForIdle();
    const st = await studentsRepo.save(A, { ...emptyStudent(), name: 'Учень' });
    const subjects = await subjectsRepo.list(A);
    const p = await scheduleRepo.savePeriod(A, { ...emptyPeriod(st.id, '2026-09-01', '2026-12-31'), name: 'І семестр' },
      [{ weekday: 1, lessonNumber: 1, subjectId: subjects[0].id, startTime: '08:30', endTime: '09:05', notes: '' }]);
    const slot = (await scheduleRepo.listSlots(st.id))[0];
    await scheduleRepo.setSlotOverride(A, p, slot, MON, { subjectId: subjects[2].id });
    expect(await waitForIdle(6000)).toBe('cloud');
    expect(remote.rows('ii_schedule_periods')).toHaveLength(1);
    expect(remote.rows('ii_schedule_templates')[0].cols).toMatchObject({ period_id: p.id, weekday: 1, lesson_number: 1, start_time: '08:30' });
    expect(remote.rows('ii_schedule_overrides')[0].cols).toMatchObject({ override_type: 'slot', template_id: slot.id, date: MON });

    // phone
    stopSync();
    resetDbInstance(`sched-sync-2-${++n}`);
    await ensureLocalAccount(A, 'A');
    await startSync(A, remote, { realtime: false, listenToBrowser: false });
    await waitForIdle();
    const day = resolveDay(MON, st.id, await scheduleRepo.loadData(st.id, MON, MON));
    expect(day.period?.name).toBe('І семестр');
    expect(day.lessons[0]).toMatchObject({ subjectId: subjects[2].id, kind: 'changed' });
    // phone cancels the exception → laptop copy in the cloud loses it too
    await scheduleRepo.resetDate(p.id, MON);
    expect(await waitForIdle(6000)).toBe('cloud');
    expect(remote.rows('ii_schedule_overrides')).toHaveLength(0);
  });
});

// Ensures the helper type stays referenced (keeps the test file self-documenting).
export type _Obs = Observation;
