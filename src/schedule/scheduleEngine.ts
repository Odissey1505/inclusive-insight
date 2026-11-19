/**
 * Smart Schedule engine (Inclusive Insight 1.2).
 *
 * The ONLY place where lessons of a date are computed:
 *   weekly template (slots) + validity period + exceptions (overrides)
 *   + legacy manual lessons + existing observations  →  lessons of the day.
 * Dashboard, Journal, Calendar, Analytics and the observation form all call these
 * functions. Nothing here touches the database, so everything is unit-tested.
 *
 * Dates are local calendar dates as 'yyyy-MM-dd' strings. Weekday maths uses
 * Date.UTC on the date parts, so no day shift can happen because of time zones.
 */
import type { Lesson, Observation, ScheduleOverride, SchedulePeriod, ScheduleSlot } from '../types/models';

/* ------------------------------------------------------------------ */
/* Calendar-date helpers (time-zone safe)                              */
/* ------------------------------------------------------------------ */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isISODate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(utcDays(v));

function utcDays(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
  return Math.round(t / 864e5);
}

function fromUtcDays(n: number): string {
  const d = new Date(n * 864e5);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const dow = new Date(utcDays(date) * 864e5).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

export const addDaysISO = (date: string, n: number) => fromUtcDays(utcDays(date) + n);
export const daysBetween = (a: string, b: string) => utcDays(b) - utcDays(a);

export function eachDateISO(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = utcDays(from), end = utcDays(to); i <= end; i++) out.push(fromUtcDays(i));
  return out;
}

/** Monday of the week containing `date`. */
export const weekStartISO = (date: string) => addDaysISO(date, 1 - isoWeekday(date));

/** Local "today" as a calendar date (never via toISOString, which is UTC). */
export function localTodayISO(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const WEEKDAYS = [
  { n: 1, short: 'Пн', label: 'Понеділок' },
  { n: 2, short: 'Вт', label: 'Вівторок' },
  { n: 3, short: 'Ср', label: 'Середа' },
  { n: 4, short: 'Чт', label: 'Четвер' },
  { n: 5, short: 'Пт', label: 'П’ятниця' },
  { n: 6, short: 'Сб', label: 'Субота' },
  { n: 7, short: 'Нд', label: 'Неділя' },
] as const;

export const DAY_OFF_LABELS: Record<string, string> = { vacation: 'Канікули', weekend: 'Вихідний', holiday: 'Святковий день', other: 'Інша причина' };

/* ------------------------------------------------------------------ */
/* Time helpers                                                         */
/* ------------------------------------------------------------------ */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v);
export const toMinutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Consecutive lesson times: first start, equal duration, one break length (or a list of breaks). */
export function autoTimes(firstStart: string, count: number, duration: number, breaks: number | number[]): { startTime: string; endTime: string }[] {
  const out: { startTime: string; endTime: string }[] = [];
  let t = toMinutes(firstStart);
  for (let i = 0; i < count; i++) {
    out.push({ startTime: fromMinutes(t), endTime: fromMinutes(t + duration) });
    t += duration + (Array.isArray(breaks) ? breaks[i] ?? breaks[breaks.length - 1] ?? 0 : breaks);
  }
  return out;
}

/** Validation of a time interval: both empty, or both set with end after start. */
export function timeProblem(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start && !end) return null;
  if ((start && !isTime(start)) || (end && !isTime(end))) return 'Час має формат ГГ:ХХ';
  if (start && end && toMinutes(end) <= toMinutes(start)) return 'Кінець уроку має бути пізніше за початок';
  return null;
}

/* ------------------------------------------------------------------ */
/* Periods                                                              */
/* ------------------------------------------------------------------ */

export const periodContains = (p: Pick<SchedulePeriod, 'startDate' | 'endDate'>, date: string) => p.startDate <= date && date <= p.endDate;

/** Active schedule for a date: not archived, date inside its range. Latest start wins if (invalidly) several match. */
export function findPeriod(periods: SchedulePeriod[], studentId: string, date: string): SchedulePeriod | null {
  let best: SchedulePeriod | null = null;
  for (const p of periods) {
    if (p.studentId !== studentId || p.archived || !periodContains(p, date)) continue;
    if (!best || p.startDate > best.startDate) best = p;
  }
  return best;
}

/** Main (non-archived) schedules of the same student whose dates overlap the candidate. */
export function findOverlaps(periods: SchedulePeriod[], candidate: Pick<SchedulePeriod, 'id' | 'studentId' | 'startDate' | 'endDate' | 'archived'>): SchedulePeriod[] {
  if (candidate.archived) return [];
  return periods.filter((p) => p.id !== candidate.id && p.studentId === candidate.studentId && !p.archived && p.startDate <= candidate.endDate && candidate.startDate <= p.endDate);
}

/** Ways to resolve an overlap: shorten the previous schedule or move the new one. */
export function overlapResolutions(existing: SchedulePeriod, candidate: Pick<SchedulePeriod, 'startDate' | 'endDate'>) {
  const out: { kind: 'trim-existing' | 'move-new'; startDate: string; endDate: string; label: string }[] = [];
  if (existing.startDate < candidate.startDate) {
    out.push({ kind: 'trim-existing', startDate: existing.startDate, endDate: addDaysISO(candidate.startDate, -1), label: 'Скоригувати дати попереднього' });
  }
  if (existing.endDate < candidate.endDate) {
    out.push({ kind: 'move-new', startDate: addDaysISO(existing.endDate, 1), endDate: candidate.endDate, label: 'Скоригувати дати нового' });
  }
  return out;
}

export function periodProblem(p: Pick<SchedulePeriod, 'name' | 'startDate' | 'endDate' | 'weekdays'>): string | null {
  if (!p.name.trim()) return 'Вкажіть назву розкладу';
  if (!isISODate(p.startDate) || !isISODate(p.endDate)) return 'Вкажіть дати початку й кінця';
  if (p.endDate < p.startDate) return 'Кінцева дата має бути не раніше за початкову';
  if (!p.weekdays.length) return 'Оберіть хоча б один навчальний день';
  return null;
}

/* ------------------------------------------------------------------ */
/* Template slots                                                       */
/* ------------------------------------------------------------------ */

export const slotEffective = (s: Pick<ScheduleSlot, 'effectiveFrom' | 'effectiveTo'>, date: string) =>
  (!s.effectiveFrom || s.effectiveFrom <= date) && (!s.effectiveTo || date <= s.effectiveTo);

/** Template lessons of a period that apply on a date (weekday + version window). */
export function slotsForDate(period: SchedulePeriod, slots: ScheduleSlot[], date: string): ScheduleSlot[] {
  const wd = isoWeekday(date);
  if (!period.weekdays.includes(wd)) return [];
  return slots.filter((s) => s.periodId === period.id && s.weekday === wd && slotEffective(s, date)).sort(byNumber);
}

/** The template as it is on a reference date (used by the editor). */
export function templateAt(period: SchedulePeriod, slots: ScheduleSlot[], date: string): ScheduleSlot[] {
  return slots.filter((s) => s.periodId === period.id && slotEffective(s, date)).sort((a, b) => a.weekday - b.weekday || a.lessonNumber - b.lessonNumber);
}

const byNumber = (a: { lessonNumber: number }, b: { lessonNumber: number }) => a.lessonNumber - b.lessonNumber;

export type SlotDraft = Pick<ScheduleSlot, 'weekday' | 'lessonNumber' | 'subjectId' | 'startTime' | 'endTime' | 'notes'> & { id?: string };

const sameSlot = (a: SlotDraft, b: SlotDraft) =>
  a.weekday === b.weekday && a.lessonNumber === b.lessonNumber && a.subjectId === b.subjectId &&
  (a.startTime || null) === (b.startTime || null) && (a.endTime || null) === (b.endTime || null) && (a.notes || '') === (b.notes || '');

export function slotsProblem(slots: SlotDraft[]): string | null {
  const seen = new Set<string>();
  for (const s of slots) {
    if (!s.subjectId) return `${WEEKDAYS[s.weekday - 1]?.label ?? ''}: оберіть предмет для уроку №${s.lessonNumber}`;
    if (!Number.isInteger(s.lessonNumber) || s.lessonNumber < 0 || s.lessonNumber > 20) return 'Номер уроку — ціле число від 0 до 20';
    const k = `${s.weekday}:${s.lessonNumber}`;
    if (seen.has(k)) return `${WEEKDAYS[s.weekday - 1]?.label ?? ''}: номер уроку №${s.lessonNumber} повторюється`;
    seen.add(k);
    const t = timeProblem(s.startTime, s.endTime);
    if (t) return `${WEEKDAYS[s.weekday - 1]?.label ?? ''}, урок №${s.lessonNumber}: ${t.toLowerCase()}`;
  }
  return null;
}

export interface TemplatePlan {
  inserts: (SlotDraft & { effectiveFrom: string | null; effectiveTo: string | null })[];
  updates: { id: string; patch: Partial<ScheduleSlot> }[];
  deletes: string[];
  /** old slot id → new slot id (for exceptions dated on/after the effective date) */
  remap: Record<string, string | null>;
  /** true when past lessons keep the previous version */
  versioned: boolean;
}

/**
 * Plans a change of the weekly template that takes effect on `effectiveDate`.
 * Lessons before that date keep the previous version (history is never rewritten).
 * `current` = slots effective on the reference date the editor was opened with.
 */
export function planTemplateChange(period: SchedulePeriod, current: ScheduleSlot[], desired: SlotDraft[], effectiveDate: string, newId: () => string): TemplatePlan {
  const plan: TemplatePlan = { inserts: [], updates: [], deletes: [], remap: {}, versioned: effectiveDate > period.startDate };
  const startsOnOrAfter = (s: ScheduleSlot) => (s.effectiveFrom ?? period.startDate) >= effectiveDate;
  const content = (d: SlotDraft) => ({ weekday: d.weekday, lessonNumber: d.lessonNumber, subjectId: d.subjectId, startTime: d.startTime || null, endTime: d.endTime || null, notes: d.notes || '' });
  const dayBefore = addDaysISO(effectiveDate, -1);

  for (const s of current) {
    const d = desired.find((x) => x.id === s.id);
    if (!d) {
      if (!plan.versioned || startsOnOrAfter(s)) plan.deletes.push(s.id);
      else plan.updates.push({ id: s.id, patch: { effectiveTo: dayBefore } });
      plan.remap[s.id] = null;
      continue;
    }
    if (sameSlot(s, d)) continue;
    if (!plan.versioned || startsOnOrAfter(s)) {
      plan.updates.push({ id: s.id, patch: content(d) });
    } else {
      const id = newId();
      plan.updates.push({ id: s.id, patch: { effectiveTo: dayBefore } });
      plan.inserts.push({ ...content(d), id, effectiveFrom: effectiveDate, effectiveTo: s.effectiveTo });
      plan.remap[s.id] = id;
    }
  }
  for (const d of desired) {
    if (d.id && current.some((s) => s.id === d.id)) continue;
    plan.inserts.push({ ...content(d), id: newId(), effectiveFrom: plan.versioned ? effectiveDate : null, effectiveTo: null });
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Resolving a day                                                      */
/* ------------------------------------------------------------------ */

export type LessonKind = 'regular' | 'changed' | 'cancelled' | 'extra' | 'manual' | 'unscheduled';
export type LessonStatus = 'none' | 'draft' | 'filled' | 'cancelled' | 'skipped';
export type LessonChange = 'subject' | 'time' | 'number' | 'note';

export interface ResolvedLesson {
  /** stable identity of the lesson on its date: 'slot:<id>' | 'extra:<id>' | 'manual:<id>' | 'obs:<id>' */
  key: string;
  date: string;
  number: number | null;
  subjectId: string;
  startTime: string | null;
  endTime: string | null;
  note: string;
  topic: string;
  kind: LessonKind;
  changes: LessonChange[];
  status: LessonStatus;
  cancelled: boolean;
  skipped: boolean;
  periodId: string | null;
  slotId: string | null;
  overrideId: string | null;
  lessonId: string | null;
  /** what the weekly template says (null for extra / manual / unscheduled) */
  scheduled: { subjectId: string; number: number; startTime: string | null; endTime: string | null } | null;
  observation: Observation | null;
  /** further observations matched to the same lesson (shown, never hidden) */
  moreObservations: Observation[];
  /** the observation keeps a different (historical) subject than the current schedule */
  historical: boolean;
}

export interface DaySchedule {
  date: string;
  weekday: number;
  period: SchedulePeriod | null;
  state: 'no-period' | 'day-off' | 'no-lessons' | 'ok';
  dayOverride: ScheduleOverride | null;
  lessons: ResolvedLesson[];
}

export interface ScheduleData {
  periods: SchedulePeriod[];
  slots: ScheduleSlot[];
  overrides: ScheduleOverride[];
  lessons: Lesson[];
  observations: Observation[];
}

export function resolveDay(date: string, studentId: string, data: ScheduleData): DaySchedule {
  const weekday = isoWeekday(date);
  const period = findPeriod(data.periods, studentId, date);
  const dayOvs = period ? data.overrides.filter((o) => o.periodId === period.id && o.date === date && o.studentId === studentId) : [];
  const dayOverride = dayOvs.find((o) => o.type === 'day') ?? null;
  const dayOff = !!dayOverride?.dayOff;
  const out: ResolvedLesson[] = [];

  const blank = (p: Partial<ResolvedLesson>): ResolvedLesson => ({
    key: '', date, number: null, subjectId: '', startTime: null, endTime: null, note: '', topic: '', kind: 'regular', changes: [],
    status: 'none', cancelled: false, skipped: false, periodId: period?.id ?? null, slotId: null, overrideId: null, lessonId: null,
    scheduled: null, observation: null, moreObservations: [], historical: false, ...p,
  });

  if (period && !dayOff) {
    for (const s of slotsForDate(period, data.slots, date)) {
      const ov = dayOvs.find((o) => o.type === 'slot' && o.slotId === s.id);
      const number = ov?.lessonNumber ?? s.lessonNumber;
      const subjectId = ov?.subjectId || s.subjectId;
      const startTime = ov?.startTime !== undefined && ov?.startTime !== null ? ov.startTime : s.startTime;
      const endTime = ov?.endTime !== undefined && ov?.endTime !== null ? ov.endTime : s.endTime;
      const changes: LessonChange[] = [];
      if (subjectId !== s.subjectId) changes.push('subject');
      if (number !== s.lessonNumber) changes.push('number');
      if (startTime !== s.startTime || endTime !== s.endTime) changes.push('time');
      if (ov?.note) changes.push('note');
      const cancelled = !!ov?.cancelled;
      out.push(blank({
        key: `slot:${s.id}`, number, subjectId, startTime, endTime, note: ov?.note || s.notes || '',
        kind: cancelled ? 'cancelled' : changes.some((c) => c !== 'note') ? 'changed' : 'regular', changes, cancelled, skipped: !!ov?.skipped,
        slotId: s.id, overrideId: ov?.id ?? null, scheduled: { subjectId: s.subjectId, number: s.lessonNumber, startTime: s.startTime, endTime: s.endTime },
      }));
    }
    for (const x of dayOvs.filter((o) => o.type === 'extra')) {
      out.push(blank({
        key: `extra:${x.id}`, number: x.lessonNumber ?? null, subjectId: x.subjectId ?? '', startTime: x.startTime ?? null, endTime: x.endTime ?? null,
        note: x.note ?? '', kind: x.cancelled ? 'cancelled' : 'extra', cancelled: !!x.cancelled, skipped: !!x.skipped, overrideId: x.id,
      }));
    }
    // Shortened lessons: recompute times from the first lesson's start.
    const sh = dayOverride?.shortened;
    if (sh && sh.duration > 0) {
      const ordered = out.filter((l) => !l.cancelled).sort(cmpLessons);
      const first = sh.firstStart || ordered.find((l) => l.startTime)?.startTime;
      if (first && isTime(first)) {
        autoTimes(first, ordered.length, sh.duration, sh.breakMinutes).forEach((t, i) => {
          const l = ordered[i];
          if (l.startTime !== t.startTime || l.endTime !== t.endTime) {
            l.startTime = t.startTime;
            l.endTime = t.endTime;
            if (!l.changes.includes('time')) l.changes.push('time');
            if (l.kind === 'regular') l.kind = 'changed';
          }
        });
      }
    }
  }

  // Lessons added manually in 1.0/1.1 (lessons table) — merged by number, never duplicated.
  for (const m of data.lessons.filter((l) => l.studentId === studentId && l.date === date)) {
    const same = out.find((l) => l.number === m.number && !l.lessonId && (l.kind !== 'extra' || l.subjectId === m.subjectId));
    if (same) {
      same.lessonId = m.id;
      if (!same.topic) same.topic = m.topic;
      continue;
    }
    if (dayOff) continue;
    out.push(blank({ key: `manual:${m.id}`, number: m.number, subjectId: m.subjectId, topic: m.topic, kind: 'manual', lessonId: m.id }));
  }

  // Observations: matched by schedule key, then lesson id, then lesson number. Each used once.
  const obs = data.observations.filter((o) => o.studentId === studentId && o.date === date)
    .sort((a, b) => (a.status === 'final' ? 0 : 1) - (b.status === 'final' ? 0 : 1) || a.createdAt - b.createdAt);
  const used = new Set<string>();
  const attach = (l: ResolvedLesson, o: Observation) => {
    used.add(o.id);
    if (!l.observation) l.observation = o;
    else l.moreObservations.push(o);
  };
  for (const o of obs) {
    const l = out.find((x) => o.scheduleKey && x.key === o.scheduleKey);
    if (l) attach(l, o);
  }
  for (const o of obs) {
    if (used.has(o.id) || !o.lessonId) continue;
    const l = out.find((x) => x.lessonId === o.lessonId);
    if (l) attach(l, o);
  }
  for (const o of obs) {
    if (used.has(o.id) || o.lessonNumber === null || o.lessonNumber === undefined) continue;
    const l = out.find((x) => x.number === o.lessonNumber && !x.observation);
    if (l) attach(l, o);
  }
  for (const o of obs) {
    if (used.has(o.id)) continue;
    out.push(blank({
      key: `obs:${o.id}`, number: o.lessonNumber ?? null, subjectId: o.subjectId, startTime: o.startTime ?? null, endTime: o.endTime ?? null,
      topic: o.topic, kind: 'unscheduled', observation: o,
    }));
    used.add(o.id);
  }

  for (const l of out) {
    const o = l.observation;
    if (o) {
      // Keep what was recorded: the observation's subject/time are history, not the current template.
      if (o.subjectId && o.subjectId !== l.subjectId) {
        l.historical = true;
        l.subjectId = o.subjectId;
      }
      if (o.startTime) l.startTime = o.startTime;
      if (o.endTime) l.endTime = o.endTime;
      if (o.topic) l.topic = o.topic;
    }
    l.status = o ? (o.status === 'draft' ? 'draft' : 'filled') : l.cancelled ? 'cancelled' : l.skipped ? 'skipped' : 'none';
  }
  out.sort(cmpLessons);

  const state: DaySchedule['state'] = dayOff ? 'day-off' : out.length ? 'ok' : period ? 'no-lessons' : 'no-period';
  return { date, weekday, period, state, dayOverride, lessons: out };
}

function cmpLessons(a: ResolvedLesson, b: ResolvedLesson) {
  const na = a.number ?? 99;
  const nb = b.number ?? 99;
  return na - nb || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.key.localeCompare(b.key);
}

export function resolveRange(from: string, to: string, studentId: string, data: ScheduleData): DaySchedule[] {
  return eachDateISO(from, to).map((d) => resolveDay(d, studentId, data));
}

/** The lesson after `current` on the same day (for "save and add next lesson"). */
export function nextLesson(day: DaySchedule, currentKey: string | null, currentNumber: number | null): ResolvedLesson | null {
  const open = day.lessons.filter((l) => !l.cancelled && !l.observation && l.key !== currentKey);
  return open.find((l) => (l.number ?? 0) > (currentNumber ?? 0)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Journal-keeping statistics (administrative, NOT student progress)    */
/* ------------------------------------------------------------------ */

export interface JournalStats {
  planned: number; // lessons by the schedule, incl. extra; days off excluded
  cancelled: number;
  held: number; // planned − cancelled
  withObservation: number;
  withoutObservation: number;
  skipped: number; // "спостереження не проводилося" (subset of withoutObservation)
  daysOff: number;
  daysWithoutSchedule: number;
  fillPct: number | null; // withObservation / held
}

/** Counts only dates up to `today` — future lessons are not "missing". */
export function journalStats(days: DaySchedule[], today: string): JournalStats {
  const s: JournalStats = { planned: 0, cancelled: 0, held: 0, withObservation: 0, withoutObservation: 0, skipped: 0, daysOff: 0, daysWithoutSchedule: 0, fillPct: null };
  for (const d of days) {
    if (d.date > today) continue;
    if (d.state === 'day-off') {
      s.daysOff++;
      continue;
    }
    if (!d.period) {
      if (isoWeekday(d.date) <= 5) s.daysWithoutSchedule++;
      continue;
    }
    for (const l of d.lessons) {
      if (l.kind === 'unscheduled' || l.kind === 'manual') continue; // not part of the plan
      s.planned++;
      if (l.cancelled) {
        s.cancelled++;
        continue;
      }
      if (l.observation) s.withObservation++;
      else {
        s.withoutObservation++;
        if (l.skipped) s.skipped++;
      }
    }
  }
  s.held = s.planned - s.cancelled;
  s.fillPct = s.held > 0 ? Math.round((s.withObservation / s.held) * 100) : null;
  return s;
}

/* ------------------------------------------------------------------ */
/* Labels                                                               */
/* ------------------------------------------------------------------ */

export const STATUS_LABELS: Record<LessonStatus, string> = {
  none: 'Спостереження відсутнє',
  draft: 'Чернетка',
  filled: 'Заповнено',
  cancelled: 'Урок скасовано',
  skipped: 'Спостереження не проводилося',
};

export const KIND_LABELS: Record<LessonKind, string> = {
  regular: 'Звичайний урок',
  changed: 'Змінений урок',
  cancelled: 'Скасований урок',
  extra: 'Додатковий урок',
  manual: 'Урок, доданий вручну',
  unscheduled: 'Запис поза розкладом',
};

export const timeRange = (l: { startTime: string | null; endTime: string | null }) =>
  l.startTime ? `${l.startTime}${l.endTime ? `–${l.endTime}` : ''}` : '';
