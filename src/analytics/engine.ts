/**
 * Local analytics engine. Pure functions over plain arrays — no I/O, no external APIs.
 *
 * Rules (see spec §12.5):
 *  - never invent values; missing values are excluded from denominators, never counted as zeros
 *  - every percentage carries its numerator and denominator
 *  - different measurement units are never mixed
 *  - no causal or medical/psychological conclusions
 */
import {
  addDays, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO, startOfMonth,
  startOfWeek, subDays,
} from 'date-fns';
import type { Achievement, IEPMeasurement, ObsEvent, Observation, StrategyUse, Subject, Task, Strategy } from '../types/models';
import { labelOf } from '../lib/catalog';
import { countBy, plural } from '../lib/utils';

export const MIN_RELIABLE = 5;

export interface Ratio {
  num: number;
  den: number;
  pct: number | null;
  lowData: boolean;
}

export function ratio(num: number, den: number): Ratio {
  return { num, den, pct: den ? Math.round((num / den) * 100) : null, lowData: den < MIN_RELIABLE };
}

export interface Dataset {
  observations: Observation[];
  tasks: Task[];
  events: ObsEvent[];
  strategyUses: StrategyUse[];
  achievements: Achievement[];
  measurements: IEPMeasurement[];
}

export const emptyDataset = (): Dataset => ({ observations: [], tasks: [], events: [], strategyUses: [], achievements: [], measurements: [] });

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export type PeriodKey = 'today' | 'last7' | 'week' | 'month' | 'last30' | 'semester' | 'year' | 'custom';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Сьогодні' },
  { key: 'last7', label: 'Останні 7 днів' },
  { key: 'week', label: 'Поточний тиждень' },
  { key: 'month', label: 'Поточний місяць' },
  { key: 'last30', label: 'Останні 30 днів' },
  { key: 'semester', label: 'Семестр' },
  { key: 'year', label: 'Навчальний рік' },
  { key: 'custom', label: 'Власний діапазон' },
];

export interface DateRange {
  from: string;
  to: string;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Ukrainian school year: 1 Sep – 31 May; semesters: Sep–Dec, Jan–May. */
export function periodRange(key: PeriodKey, custom?: DateRange, ref = new Date()): DateRange {
  switch (key) {
    case 'today':
      return { from: iso(ref), to: iso(ref) };
    case 'last7':
      return { from: iso(subDays(ref, 6)), to: iso(ref) };
    case 'week':
      return { from: iso(startOfWeek(ref, { weekStartsOn: 1 })), to: iso(endOfWeek(ref, { weekStartsOn: 1 })) };
    case 'month':
      return { from: iso(startOfMonth(ref)), to: iso(endOfMonth(ref)) };
    case 'last30':
      return { from: iso(subDays(ref, 29)), to: iso(ref) };
    case 'semester': {
      const m = ref.getMonth();
      const y = ref.getFullYear();
      if (m >= 7) return { from: `${y}-09-01`, to: `${y}-12-31` };
      return { from: `${y}-01-01`, to: `${y}-05-31` };
    }
    case 'year': {
      const y = ref.getMonth() >= 7 ? ref.getFullYear() : ref.getFullYear() - 1;
      return { from: `${y}-09-01`, to: `${y + 1}-05-31` };
    }
    case 'custom':
      return custom ?? { from: iso(subDays(ref, 29)), to: iso(ref) };
  }
}

/** The range of equal length immediately before `r`. */
export function previousRange(r: DateRange): DateRange {
  const from = parseISO(r.from);
  const len = differenceInCalendarDays(parseISO(r.to), from) + 1;
  return { from: iso(subDays(from, len)), to: iso(subDays(from, 1)) };
}

export const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export interface Filters {
  subjectIds?: string[];
  taskType?: string | null;
  strategyId?: string | null;
  behavior?: string | null;
}

export function applyFilters(ds: Dataset, f: Filters): Dataset {
  let obs = ds.observations.filter((o) => o.status !== 'draft');
  if (f.subjectIds?.length) obs = obs.filter((o) => f.subjectIds!.includes(o.subjectId));
  if (f.strategyId) obs = obs.filter((o) => o.strategyIds?.includes(f.strategyId!));
  if (f.behavior) obs = obs.filter((o) => o.behaviors.includes(f.behavior!));
  const ids = new Set(obs.map((o) => o.id));
  let tasks = ds.tasks.filter((t) => ids.has(t.observationId));
  if (f.taskType) tasks = tasks.filter((t) => t.type === f.taskType);
  return {
    observations: obs,
    tasks,
    events: ds.events.filter((e) => ids.has(e.observationId)),
    strategyUses: ds.strategyUses.filter((u) => (u.observationId ? ids.has(u.observationId) : !f.subjectIds?.length || (u.subjectId && f.subjectIds.includes(u.subjectId))) && (!f.strategyId || u.strategyId === f.strategyId)),
    achievements: ds.achievements.filter((a) => !f.subjectIds?.length || (a.subjectId && f.subjectIds.includes(a.subjectId))),
    measurements: ds.measurements,
  };
}

/* ------------------------------------------------------------------ */
/* Core metrics                                                        */
/* ------------------------------------------------------------------ */

export interface Metrics {
  lessons: number;
  tasks: number;
  /** Tasks with recorded participation (active|partial) / tasks where participation was assessed */
  participation: Ratio;
  /** Fully completed tasks / tasks with a known result */
  completion: Ratio;
  /** Fully + partially completed / known result */
  completionAny: Ratio;
  /** Tasks done with support "none" / tasks with recorded support level */
  independence: Ratio;
  /** Lessons where the student started work independently / lessons where task start was assessed */
  independentStart: Ratio;
  /** Lessons with engagement active|most / lessons where engagement was observed */
  engagement: Ratio;
  supportCounts: Map<string, number>;
  lessonSupportCounts: Map<string, number>;
  behaviorCounts: Map<string, number>;
  eventCounts: Map<string, number>;
  engagementCounts: Map<string, number>;
  achievements: number;
  volumeByUnit: { unit: string; offered: number; completed: number; tasks: number }[];
}

export function computeMetrics(ds: Dataset): Metrics {
  const obs = ds.observations.filter((o) => o.status !== 'draft');
  const tasks = ds.tasks;

  const partAssessed = tasks.filter((t) => t.participation);
  const partYes = partAssessed.filter((t) => t.participation === 'active' || t.participation === 'partial');
  const known = tasks.filter((t) => t.result);
  const full = known.filter((t) => t.result === 'full');
  const anyDone = known.filter((t) => t.result === 'full' || t.result === 'partial');
  const withSupport = tasks.filter((t) => t.support);
  const independent = withSupport.filter((t) => t.support === 'none');
  const startAssessed = obs.filter((o) => o.taskStart && o.taskStart !== 'not_assessed');
  const startIndep = startAssessed.filter((o) => o.taskStart === 'independent');
  const engObserved = obs.filter((o) => o.engagement && o.engagement !== 'not_observed');
  const engActive = engObserved.filter((o) => o.engagement === 'active' || o.engagement === 'most');

  const units = new Map<string, { offered: number; completed: number; tasks: number }>();
  for (const t of tasks) {
    if (t.offered === null || t.completed === null || !t.unit) continue;
    const u = units.get(t.unit) ?? { offered: 0, completed: 0, tasks: 0 };
    u.offered += t.offered;
    u.completed += t.completed;
    u.tasks += 1;
    units.set(t.unit, u);
  }

  return {
    lessons: obs.length,
    tasks: tasks.length,
    participation: ratio(partYes.length, partAssessed.length),
    completion: ratio(full.length, known.length),
    completionAny: ratio(anyDone.length, known.length),
    independence: ratio(independent.length, withSupport.length),
    independentStart: ratio(startIndep.length, startAssessed.length),
    engagement: ratio(engActive.length, engObserved.length),
    supportCounts: countBy(withSupport, (t) => t.support),
    lessonSupportCounts: countBy(obs, (o) => o.supportLevels),
    behaviorCounts: countBy(obs, (o) => o.behaviors),
    eventCounts: countBy(ds.events, (e) => e.type),
    engagementCounts: countBy(obs, (o) => o.engagement),
    achievements: ds.achievements.length,
    volumeByUnit: [...units.entries()].map(([unit, v]) => ({ unit, ...v })).sort((a, b) => b.tasks - a.tasks),
  };
}

/* ------------------------------------------------------------------ */
/* Time series                                                         */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  lessons: number;
  participation: number | null;
  completion: number | null;
  independence: number | null;
  engagement: number | null;
  independentStart: number | null;
  nTasks: number;
}

/** Groups by day (≤ 31 days) or by ISO week (longer ranges). Buckets without data have nulls, not zeros. */
export function timeSeries(ds: Dataset, range: DateRange, granularity?: 'day' | 'week'): SeriesPoint[] {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  const len = differenceInCalendarDays(to, from) + 1;
  const g = granularity ?? (len > 31 ? 'week' : 'day');
  const buckets: { key: string; label: string; from: string; to: string }[] = [];
  if (g === 'day') {
    for (const d of eachDayOfInterval({ start: from, end: to })) {
      buckets.push({ key: iso(d), label: format(d, 'dd.MM'), from: iso(d), to: iso(d) });
    }
  } else {
    let cur = startOfWeek(from, { weekStartsOn: 1 });
    while (cur <= to) {
      const end = addDays(cur, 6);
      buckets.push({ key: iso(cur), label: `${format(cur, 'dd.MM')}`, from: iso(cur), to: iso(end) });
      cur = addDays(cur, 7);
    }
  }
  return buckets.map((b) => {
    const sub = sliceByRange(ds, b);
    const m = computeMetrics(sub);
    return {
      ...b,
      lessons: m.lessons,
      participation: m.participation.pct,
      completion: m.completion.pct,
      independence: m.independence.pct,
      engagement: m.engagement.pct,
      independentStart: m.independentStart.pct,
      nTasks: m.tasks,
    };
  });
}

export function sliceByRange(ds: Dataset, r: DateRange): Dataset {
  return {
    observations: ds.observations.filter((o) => inRange(o.date, r)),
    tasks: ds.tasks.filter((t) => inRange(t.date, r)),
    events: ds.events.filter((e) => inRange(e.date, r)),
    strategyUses: ds.strategyUses.filter((u) => inRange(u.date, r)),
    achievements: ds.achievements.filter((a) => inRange(a.date, r)),
    measurements: ds.measurements.filter((m) => inRange(m.date, r)),
  };
}

/* ------------------------------------------------------------------ */
/* By subject                                                          */
/* ------------------------------------------------------------------ */

export interface SubjectRow {
  subjectId: string;
  name: string;
  color: string;
  lessons: number;
  tasks: number;
  completion: Ratio;
  independence: Ratio;
  participation: Ratio;
  engagement: Ratio;
  support: Record<string, number>;
}

export function bySubject(ds: Dataset, subjects: Subject[]): SubjectRow[] {
  const rows: SubjectRow[] = [];
  for (const s of subjects) {
    const obs = ds.observations.filter((o) => o.subjectId === s.id && o.status !== 'draft');
    if (!obs.length) continue;
    const ids = new Set(obs.map((o) => o.id));
    const m = computeMetrics({ ...emptyDataset(), observations: obs, tasks: ds.tasks.filter((t) => ids.has(t.observationId)) });
    rows.push({
      subjectId: s.id, name: s.name, color: s.color, lessons: m.lessons, tasks: m.tasks,
      completion: m.completion, independence: m.independence, participation: m.participation, engagement: m.engagement,
      support: Object.fromEntries(m.supportCounts),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export type HeatMetric = 'participation' | 'independence' | 'completion' | 'events' | 'records';

export const HEAT_METRICS: { key: HeatMetric; label: string; isPct: boolean }[] = [
  { key: 'participation', label: 'Участь', isPct: true },
  { key: 'independence', label: 'Самостійність', isPct: true },
  { key: 'completion', label: 'Завершення завдань', isPct: true },
  { key: 'events', label: 'Частота подій', isPct: false },
  { key: 'records', label: 'Кількість записів', isPct: false },
];

/** Returns value per day; days without relevant data are absent (rendered neutral). */
export function heatmap(ds: Dataset, metric: HeatMetric): Map<string, { value: number; n: number }> {
  const out = new Map<string, { value: number; n: number }>();
  const days = new Set(ds.observations.filter((o) => o.status !== 'draft').map((o) => o.date));
  for (const d of days) {
    const sub = sliceByRange(ds, { from: d, to: d });
    const m = computeMetrics(sub);
    let r: { value: number; n: number } | null = null;
    if (metric === 'records') r = { value: m.lessons, n: m.lessons };
    else if (metric === 'events') r = { value: sub.events.length + sub.observations.reduce((a, o) => a + o.behaviors.length, 0), n: m.lessons };
    else {
      const rr = m[metric];
      if (rr.pct !== null) r = { value: rr.pct, n: rr.den };
    }
    if (r) out.set(d, r);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Period comparison                                                   */
/* ------------------------------------------------------------------ */

export interface Comparison {
  metric: string;
  label: string;
  a: Ratio;
  b: Ratio;
  diff: number | null;
}

export function comparePeriods(a: Dataset, b: Dataset): Comparison[] {
  const ma = computeMetrics(a);
  const mb = computeMetrics(b);
  const keys: [keyof Metrics, string][] = [
    ['participation', 'Навчальна участь'],
    ['completion', 'Завершення завдань'],
    ['independence', 'Самостійність'],
    ['independentStart', 'Самостійний початок'],
    ['engagement', 'Активна залученість'],
  ];
  return keys.map(([k, label]) => {
    const ra = ma[k] as Ratio;
    const rb = mb[k] as Ratio;
    return { metric: k, label, a: ra, b: rb, diff: ra.pct !== null && rb.pct !== null ? ra.pct - rb.pct : null };
  });
}

/* ------------------------------------------------------------------ */
/* Strategy statistics                                                 */
/* ------------------------------------------------------------------ */

export interface StrategyStat {
  strategyId: string;
  uses: number;
  helped: number;
  partial: number;
  noEffect: number;
  unknown: number;
  assessed: number;
  lastDate: string | null;
}

export function strategyStats(uses: StrategyUse[]): Map<string, StrategyStat> {
  const m = new Map<string, StrategyStat>();
  for (const u of uses) {
    const s = m.get(u.strategyId) ?? { strategyId: u.strategyId, uses: 0, helped: 0, partial: 0, noEffect: 0, unknown: 0, assessed: 0, lastDate: null };
    s.uses++;
    if (u.result === 'helped') s.helped++;
    else if (u.result === 'partial') s.partial++;
    else if (u.result === 'no_effect') s.noEffect++;
    else s.unknown++;
    if (u.result && u.result !== 'unknown') s.assessed++;
    if (!s.lastDate || u.date > s.lastDate) s.lastDate = u.date;
    m.set(u.strategyId, s);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Rule-based insights (NOT AI)                                        */
/* ------------------------------------------------------------------ */

export interface Insight {
  id: string;
  tone: 'positive' | 'neutral' | 'info' | 'warning';
  text: string;
  basis: string;
}

const top = (m: Map<string, number>, exclude: string[] = []) =>
  [...m.entries()].filter(([k]) => !exclude.includes(k)).sort((a, b) => b[1] - a[1])[0];

export function generateInsights(
  cur: Dataset,
  prev: Dataset | null,
  ctx: { subjects: Subject[]; strategies: Strategy[] },
): Insight[] {
  const out: Insight[] = [];
  const m = computeMetrics(cur);

  if (m.lessons === 0) {
    return [{ id: 'nodata', tone: 'info', text: 'За обраний період немає збережених спостережень.', basis: '0 записів' }];
  }
  if (m.lessons < MIN_RELIABLE) {
    out.push({
      id: 'lowdata', tone: 'info',
      text: 'Для надійного порівняння поки недостатньо спостережень.',
      basis: `${m.lessons} ${plural(m.lessons, 'запис', 'записи', 'записів')} (рекомендовано ≥ ${MIN_RELIABLE})`,
    });
  }

  // 1. Independent starts vs previous period
  if (prev) {
    const mp = computeMetrics(prev);
    const a = m.independentStart;
    const b = mp.independentStart;
    if (a.den >= 3 && b.den >= 3) {
      if (a.num > b.num) {
        out.push({ id: 'start-up', tone: 'positive', text: `У цьому періоді самостійно розпочатих завдань було більше, ніж у попередньому (${a.num} проти ${b.num}).`, basis: `уроків з оцінкою початку: ${a.den} / ${b.den}` });
      } else if (a.num < b.num) {
        out.push({ id: 'start-down', tone: 'neutral', text: `У цьому періоді самостійно розпочатих завдань було менше, ніж у попередньому (${a.num} проти ${b.num}).`, basis: `уроків з оцінкою початку: ${a.den} / ${b.den}` });
      }
    }
    const c1 = m.completion;
    const c0 = mp.completion;
    if (c1.den >= MIN_RELIABLE && c0.den >= MIN_RELIABLE && c1.pct !== null && c0.pct !== null && Math.abs(c1.pct - c0.pct) >= 10) {
      out.push({
        id: 'completion-change', tone: c1.pct > c0.pct ? 'positive' : 'neutral',
        text: `Частка повністю виконаних завдань ${c1.pct > c0.pct ? 'зросла' : 'знизилася'}: ${c0.pct}% → ${c1.pct}%.`,
        basis: `завдань з відомим результатом: ${c0.den} → ${c1.den}`,
      });
    }
    const i1 = m.independence;
    const i0 = mp.independence;
    if (i1.den >= MIN_RELIABLE && i0.den >= MIN_RELIABLE && i1.pct !== null && i0.pct !== null && Math.abs(i1.pct - i0.pct) >= 10) {
      out.push({
        id: 'indep-change', tone: i1.pct > i0.pct ? 'positive' : 'neutral',
        text: `Частка завдань, виконаних без допомоги, ${i1.pct > i0.pct ? 'зросла' : 'знизилася'}: ${i0.pct}% → ${i1.pct}%.`,
        basis: `завдань із зазначеною підтримкою: ${i0.den} → ${i1.den}`,
      });
    }
  }

  // 2. Most frequent support per subject (excluding "none")
  const subjRows = bySubject(cur, ctx.subjects);
  for (const row of subjRows.sort((a, b) => b.tasks - a.tasks).slice(0, 3)) {
    const supMap = new Map(Object.entries(row.support));
    const t = top(supMap, ['none']);
    const total = [...supMap.entries()].filter(([k]) => k !== 'none').reduce((a, [, v]) => a + v, 0);
    if (t && total >= 3) {
      out.push({
        id: `subj-support-${row.subjectId}`, tone: 'info',
        text: `На уроках «${row.name}» найчастіше використовувалася підтримка «${labelOf('support', t[0]).toLowerCase()}».`,
        basis: `${t[1]} із ${total} завдань з підтримкою`,
      });
    }
  }

  // 3. Support type → started work
  const obs = cur.observations.filter((o) => o.taskStart && o.taskStart !== 'not_assessed');
  const supTypes = ['visual', 'model', 'verbal', 'repeat', 'stepwise'];
  let best: { key: string; yes: number; n: number } | null = null;
  for (const s of supTypes) {
    const withS = obs.filter((o) => o.supportLevels.includes(s));
    if (withS.length < 3) continue;
    const yes = withS.filter((o) => o.taskStart !== 'not_started').length;
    if (!best || yes / withS.length > best.yes / best.n || (yes / withS.length === best.yes / best.n && withS.length > best.n)) best = { key: s, yes, n: withS.length };
  }
  if (best) {
    out.push({
      id: 'support-start', tone: 'info',
      text: `Коли застосовувалася підтримка «${labelOf('support', best.key).toLowerCase()}», учень розпочав роботу в ${best.yes} із ${best.n} зафіксованих випадків.`,
      basis: 'збіг у часі, не причинно-наслідковий зв\'язок',
    });
  }

  // 4. Subject comparison
  const reliable = subjRows.filter((r) => r.completion.den >= 3 && r.completion.pct !== null);
  if (reliable.length >= 2) {
    const sorted = [...reliable].sort((a, b) => b.completion.pct! - a.completion.pct!);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    if (hi.completion.pct! - lo.completion.pct! >= 15) {
      out.push({
        id: 'subj-compare', tone: 'info',
        text: `Найвища частка повністю виконаних завдань — «${hi.name}» (${hi.completion.pct}%), найнижча — «${lo.name}» (${lo.completion.pct}%).`,
        basis: `завдань: ${hi.completion.den} і ${lo.completion.den}`,
      });
    }
  }

  // 5. Strategy with best recorded result
  const stats = [...strategyStats(cur.strategyUses).values()].filter((s) => s.assessed >= 3);
  if (stats.length) {
    const s = stats.sort((a, b) => b.helped / b.assessed - a.helped / a.assessed)[0];
    const name = ctx.strategies.find((x) => x.id === s.strategyId)?.name ?? 'Стратегія';
    out.push({
      id: 'strategy-best', tone: 'positive',
      text: `Стратегію «${name}» відзначено як таку, що допомогла, у ${s.helped} із ${s.assessed} оцінених застосувань.`,
      basis: `усього застосувань: ${s.uses}`,
    });
  }

  // 6. Most frequent observed behaviour (neutral wording)
  const tb = top(m.behaviorCounts, ['other']);
  if (tb && tb[1] >= 3) {
    out.push({
      id: 'behavior-top', tone: 'neutral',
      text: `Найчастіше фіксувалося: «${labelOf('behaviors', tb[0])}» — на ${tb[1]} із ${m.lessons} уроків.`,
      basis: 'частота відміток у спостереженнях',
    });
  }

  // 7. Achievements
  if (m.achievements > 0) {
    out.push({
      id: 'achievements', tone: 'positive',
      text: `За період задокументовано ${m.achievements} ${plural(m.achievements, 'досягнення', 'досягнення', 'досягнень')}.`,
      basis: 'щоденник досягнень',
    });
  }

  // 8. Data quality
  const unknownRes = cur.tasks.filter((t) => !t.result).length;
  if (cur.tasks.length >= 5 && unknownRes / cur.tasks.length > 0.3) {
    out.push({
      id: 'data-quality', tone: 'warning',
      text: `Для ${unknownRes} із ${cur.tasks.length} завдань не зазначено результат — вони не враховуються у відсотках завершення.`,
      basis: 'якість даних',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Report summary (rule-based text draft)                              */
/* ------------------------------------------------------------------ */

export function summaryText(ds: Dataset, ctx: { subjects: Subject[]; strategies: Strategy[]; studentName: string; range: DateRange }): string {
  const m = computeMetrics(ds);
  if (m.lessons === 0) return 'Протягом звітного періоду спостереження не зафіксовано.';
  const parts: string[] = [];
  parts.push(`Протягом звітного періоду зафіксовано ${m.lessons} ${plural(m.lessons, 'навчальне заняття', 'навчальні заняття', 'навчальних занять')}.`);
  const lessonsWithWork = new Set(ds.tasks.filter((t) => t.result === 'full' || t.result === 'partial').map((t) => t.observationId));
  const lessonsWithKnown = new Set(ds.tasks.filter((t) => t.result).map((t) => t.observationId));
  if (lessonsWithKnown.size) {
    parts.push(`На ${lessonsWithWork.size} з ${lessonsWithKnown.size} занять, де фіксувалися завдання, учень виконував запропоновані завдання повністю або частково.`);
  }
  if (m.completion.den) parts.push(`Повністю виконано ${m.completion.num} з ${m.completion.den} завдань із відомим результатом (${m.completion.pct}%).`);
  if (m.independence.den) parts.push(`Без допомоги виконано ${m.independence.num} з ${m.independence.den} завдань, для яких зазначено рівень підтримки.`);
  const sup = [...m.supportCounts.entries()].filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (sup.length) parts.push(`Найчастіше використовувалися ${sup.map(([k]) => `«${labelOf('support', k).toLowerCase()}»`).join(' та ')}.`);
  const st = [...strategyStats(ds.strategyUses).values()].sort((a, b) => b.uses - a.uses)[0];
  if (st) {
    const nm = ctx.strategies.find((s) => s.id === st.strategyId)?.name;
    if (nm) parts.push(`Найчастіше застосовувана стратегія — «${nm}» (${st.uses} раз(и)${st.assessed ? `, з них ${st.helped} відзначено як ефективні` : ''}).`);
  }
  if (m.achievements) parts.push(`Задокументовано ${m.achievements} ${plural(m.achievements, 'досягнення', 'досягнення', 'досягнень')}.`);
  if (m.lessons < MIN_RELIABLE) parts.push('Кількість спостережень невелика, тому висновки мають попередній характер.');
  parts.push('Наведені дані є педагогічними спостереженнями й не є медичним чи психологічним висновком.');
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export interface TimelineItem {
  date: string;
  kind: 'event' | 'achievement' | 'note' | 'measurement';
  title: string;
  detail: string;
  refId: string;
}

export function timeline(ds: Dataset, subjects: Subject[]): TimelineItem[] {
  const subj = (id?: string) => subjects.find((s) => s.id === id)?.name ?? '';
  const items: TimelineItem[] = [
    ...ds.events.map((e) => ({ date: e.date, kind: 'event' as const, title: labelOf('eventType', e.type), detail: [subj(e.subjectId), e.description].filter(Boolean).join(' · '), refId: e.observationId })),
    ...ds.achievements.map((a) => ({ date: a.date, kind: 'achievement' as const, title: a.title, detail: labelOf('achievement', a.category), refId: a.id })),
    ...ds.observations.filter((o) => o.notes && o.status !== 'draft').map((o) => ({ date: o.date, kind: 'note' as const, title: subj(o.subjectId) || 'Нотатка', detail: o.notes, refId: o.id })),
  ];
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
