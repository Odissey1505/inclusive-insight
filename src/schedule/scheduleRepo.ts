/**
 * Smart Schedule data access. All writes go through Dexie, so they are captured
 * by the 1.1 sync engine and sent to Supabase like every other record.
 */
import { db } from '../db/database';
import { lessonsRepo } from '../db/repositories';
import { uid } from '../lib/utils';
import type { ID, ScheduleOverride, SchedulePeriod, ScheduleSlot } from '../types/models';
import {
  addDaysISO, periodContains, planTemplateChange, templateAt, type ScheduleData, type SlotDraft,
} from './scheduleEngine';

const now = () => Date.now();
const TABLES = () => [db.schedulePeriods, db.scheduleSlots, db.scheduleOverrides];

export type PeriodInput = Omit<SchedulePeriod, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID };
export type OverridePatch = Partial<Pick<ScheduleOverride, 'cancelled' | 'skipped' | 'subjectId' | 'lessonNumber' | 'startTime' | 'endTime' | 'note' | 'reason'>>;

export function emptyPeriod(studentId: ID, start: string, end: string): PeriodInput {
  return { studentId, name: '', academicYear: '', startDate: start, endDate: end, weekdays: [1, 2, 3, 4, 5], description: '', archived: false, basedOnId: null };
}

/**
 * Synchronous deterministic UUID (cyrb128). Synchronous on purpose: it is used inside
 * Dexie transactions, which must not wait for non-IndexedDB promises (e.g. crypto.subtle).
 */
export function hashUuid(name: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < name.length; i++) {
    const k = name.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  const v = (parseInt(hex[16], 16) & 0x3) | 0x8;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${v.toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic ids: one 'slot' exception per (period, date, lesson) and one 'day' exception per (period, date). */
export const slotOverrideId = (periodId: ID, date: string, slotId: ID) => hashUuid(`schedule:${periodId}:${date}:slot:${slotId}`);
export const dayOverrideId = (periodId: ID, date: string) => hashUuid(`schedule:${periodId}:${date}:day`);

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const scheduleRepo = {
  listPeriods: (studentId: ID) => db.schedulePeriods.where('studentId').equals(studentId).toArray(),
  listSlots: (studentId: ID) => db.scheduleSlots.where('studentId').equals(studentId).toArray(),
  getPeriod: (id: ID) => db.schedulePeriods.get(id),

  /** Everything the engine needs for a date range (one round-trip per table). */
  async loadData(studentId: ID, from: string, to: string): Promise<ScheduleData> {
    const [periods, slots, overrides, lessons, observations] = await Promise.all([
      db.schedulePeriods.where('studentId').equals(studentId).toArray(),
      db.scheduleSlots.where('studentId').equals(studentId).toArray(),
      db.scheduleOverrides.where('[studentId+date]').between([studentId, from], [studentId, to], true, true).toArray(),
      lessonsRepo.listRange(studentId, from, to),
      db.observations.where('[studentId+date]').between([studentId, from], [studentId, to], true, true).toArray(),
    ]);
    return { periods, slots, overrides, lessons, observations };
  },

  /**
   * Creates or updates a schedule and its weekly template in one transaction.
   * - `adjust`: date corrections of other schedules (to resolve an overlap), applied first.
   * - `effectiveDate`: from which date template changes apply; earlier lessons keep the old version.
   */
  async savePeriod(ownerId: ID, input: PeriodInput, desired: SlotDraft[] | null, opts: { effectiveDate?: string; adjust?: { id: ID; startDate: string; endDate: string }[] } = {}) {
    let saved!: SchedulePeriod;
    await db.transaction('rw', TABLES(), async () => {
      for (const a of opts.adjust ?? []) await db.schedulePeriods.update(a.id, { startDate: a.startDate, endDate: a.endDate, updatedAt: now() });
      const existing = input.id ? await db.schedulePeriods.get(input.id) : undefined;
      saved = clean({
        ...existing, ...input, id: input.id ?? uid(), ownerId, createdAt: existing?.createdAt ?? now(), updatedAt: now(),
        weekdays: [...input.weekdays].sort(), isDemo: (existing as any)?.isDemo,
      }) as SchedulePeriod;
      await db.schedulePeriods.put(saved);
      if (!desired) return;

      const allSlots = await db.scheduleSlots.where('periodId').equals(saved.id).toArray();
      let eff = opts.effectiveDate && periodContains(saved, opts.effectiveDate) ? opts.effectiveDate : saved.startDate;
      if (!existing) eff = saved.startDate;
      const current = templateAt(saved, allSlots, eff);
      const plan = planTemplateChange(saved, current, desired.filter((d) => saved.weekdays.includes(d.weekday)), eff, uid);
      for (const id of plan.deletes) await db.scheduleSlots.delete(id);
      for (const u of plan.updates) await db.scheduleSlots.update(u.id, { ...u.patch, updatedAt: now() });
      for (const ins of plan.inserts) {
        const { id, ...rest } = ins;
        await db.scheduleSlots.add({ ...rest, id: id!, ownerId, studentId: saved.studentId, periodId: saved.id, notes: rest.notes ?? '', createdAt: now(), updatedAt: now() } as ScheduleSlot);
      }
      // Exceptions on/after the effective date follow the new version of their lesson.
      const affected = await db.scheduleOverrides.where('periodId').equals(saved.id)
        .filter((o) => o.type === 'slot' && !!o.slotId && o.slotId in plan.remap && o.date >= eff).toArray();
      for (const o of affected) {
        await db.scheduleOverrides.delete(o.id);
        const target = plan.remap[o.slotId!];
        if (target) await db.scheduleOverrides.put({ ...o, id: slotOverrideId(saved.id, o.date, target), slotId: target, updatedAt: now() });
      }
      // Weekdays removed from the schedule: their template lessons stop applying from the effective date.
      const dropped = await db.scheduleSlots.where('periodId').equals(saved.id).filter((s) => !saved.weekdays.includes(s.weekday) && !s.effectiveTo).toArray();
      for (const s of dropped) {
        if ((s.effectiveFrom ?? saved.startDate) >= eff || !existing) await db.scheduleSlots.delete(s.id);
        else await db.scheduleSlots.update(s.id, { effectiveTo: addDaysISO(eff, -1), updatedAt: now() });
      }
    });
    return saved;
  },

  async setArchived(id: ID, archived: boolean) {
    await db.schedulePeriods.update(id, { archived, updatedAt: now() });
  },

  /** Observations recorded while this schedule was active (they are never deleted with it). */
  async linkedObservationCount(p: SchedulePeriod) {
    return db.observations.where('[studentId+date]').between([p.studentId, p.startDate], [p.studentId, p.endDate], true, true).count();
  },

  /** Deletes the schedule, its template and exceptions. Observations stay untouched. */
  async deletePeriod(id: ID) {
    await db.transaction('rw', TABLES(), async () => {
      await db.scheduleOverrides.where('periodId').equals(id).delete();
      await db.scheduleSlots.where('periodId').equals(id).delete();
      await db.schedulePeriods.delete(id);
    });
  },

  /* ---------- exceptions for one date ---------- */

  /** Changes one template lesson on one date. Values equal to the template are dropped; an empty exception is removed. */
  async setSlotOverride(ownerId: ID, period: SchedulePeriod, slot: ScheduleSlot, date: string, patch: OverridePatch) {
    const id = slotOverrideId(period.id, date, slot.id);
    const existing = await db.scheduleOverrides.get(id);
    const merged: ScheduleOverride = {
      ...(existing ?? { id, ownerId, studentId: period.studentId, periodId: period.id, date, type: 'slot', slotId: slot.id, createdAt: now() }),
      ...patch, updatedAt: now(),
    } as ScheduleOverride;
    if (merged.subjectId === slot.subjectId) merged.subjectId = null;
    if (merged.lessonNumber === slot.lessonNumber) merged.lessonNumber = null;
    if (merged.startTime === slot.startTime) merged.startTime = null;
    if (merged.endTime === slot.endTime) merged.endTime = null;
    const empty = !merged.cancelled && !merged.skipped && !merged.subjectId && merged.lessonNumber == null && !merged.startTime && !merged.endTime && !merged.note;
    if (empty) {
      if (existing) await db.scheduleOverrides.delete(id);
      return null;
    }
    await db.scheduleOverrides.put(clean(merged));
    return merged;
  },

  async addExtra(ownerId: ID, period: SchedulePeriod, date: string, data: Required<Pick<ScheduleOverride, 'subjectId'>> & OverridePatch) {
    const rec: ScheduleOverride = clean({
      id: uid(), ownerId, studentId: period.studentId, periodId: period.id, date, type: 'extra', slotId: null,
      ...data, createdAt: now(), updatedAt: now(),
    }) as ScheduleOverride;
    await db.scheduleOverrides.add(rec);
    return rec;
  },

  async updateOverride(id: ID, patch: OverridePatch) {
    await db.scheduleOverrides.update(id, { ...patch, updatedAt: now() });
  },

  removeOverride: (id: ID) => db.scheduleOverrides.delete(id),

  /** Whole-day exception: no lessons (with a reason) or shortened lessons. */
  async setDay(ownerId: ID, period: SchedulePeriod, date: string, patch: Pick<ScheduleOverride, 'dayOff' | 'shortened' | 'reason'>) {
    const id = dayOverrideId(period.id, date);
    const existing = await db.scheduleOverrides.get(id);
    const rec = clean({
      ...(existing ?? { id, ownerId, studentId: period.studentId, periodId: period.id, date, type: 'day', slotId: null, createdAt: now() }),
      ...patch, updatedAt: now(),
    }) as ScheduleOverride;
    if (!rec.dayOff && !rec.shortened) {
      if (existing) await db.scheduleOverrides.delete(id);
      return null;
    }
    await db.scheduleOverrides.put(rec);
    return rec;
  },

  /** Back to the standard schedule for a date (removes every exception of that date). */
  async resetDate(periodId: ID, date: string) {
    await db.scheduleOverrides.where('periodId').equals(periodId).filter((o) => o.date === date).delete();
  },

  /** Copies the weekly template of another schedule (for "create based on previous"). */
  async templateOf(periodId: ID): Promise<SlotDraft[]> {
    const p = await db.schedulePeriods.get(periodId);
    if (!p) return [];
    const slots = await db.scheduleSlots.where('periodId').equals(periodId).toArray();
    const ref = slots.some((s) => !s.effectiveTo) ? p.endDate : p.startDate;
    return templateAt(p, slots, ref).map(({ weekday, lessonNumber, subjectId, startTime, endTime, notes }) => ({ weekday, lessonNumber, subjectId, startTime, endTime, notes }));
  },
};
