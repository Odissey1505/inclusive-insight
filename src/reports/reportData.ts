import { loadDataset } from '../analytics/loader';
import {
  applyFilters, bySubject, computeMetrics, generateInsights, summaryText, strategyStats, type DateRange, type Insight,
} from '../analytics/engine';
import { db } from '../db/database';
import { labelOf, ACHIEVEMENT_CATEGORIES, SUPPORT_LEVELS } from '../lib/catalog';
import { fmtDate } from '../lib/utils';
import type { Student, Subject, Strategy, IEPGoal, IEPMeasurement } from '../types/models';

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'semester' | 'year' | 'subject' | 'category' | 'iep' | 'team';

export const REPORT_TYPES: { key: ReportType; label: string; hint: string }[] = [
  { key: 'daily', label: 'Щоденний', hint: 'Один день — усі уроки' },
  { key: 'weekly', label: 'Тижневий', hint: 'Поточний або обраний тиждень' },
  { key: 'monthly', label: 'Місячний', hint: 'Календарний місяць' },
  { key: 'semester', label: 'Семестровий', hint: 'Вересень–грудень або січень–травень' },
  { key: 'year', label: 'Річний', hint: 'Навчальний рік' },
  { key: 'subject', label: 'За предметом', hint: 'Оберіть один чи кілька предметів' },
  { key: 'category', label: 'За категорією', hint: 'Поведінка, підтримка, комунікація' },
  { key: 'iep', label: 'За цілями ІПР', hint: 'Прогрес за цілями та вимірюваннями' },
  { key: 'team', label: 'Для команди супроводу', hint: 'Розширений підсумок для ППС' },
];

export interface ReportInclude {
  summary: boolean;
  metrics: boolean;
  charts: boolean;
  subjects: boolean;
  observations: boolean;
  notes: boolean;
  achievements: boolean;
  iep: boolean;
  categories: boolean;
  insights: boolean;
}

export const defaultInclude = (type: ReportType): ReportInclude => ({
  summary: true,
  metrics: type !== 'iep',
  charts: type !== 'daily',
  subjects: !['daily', 'iep'].includes(type),
  observations: ['daily', 'weekly', 'subject'].includes(type),
  notes: ['daily', 'weekly', 'team'].includes(type),
  achievements: type !== 'category',
  iep: ['iep', 'team', 'semester', 'year', 'monthly'].includes(type),
  categories: ['category', 'team', 'monthly', 'semester', 'year'].includes(type),
  insights: type !== 'daily',
});

export interface ReportConfig {
  type: ReportType;
  studentId: string;
  range: DateRange;
  subjectIds: string[];
  include: ReportInclude;
  authorName: string;
}

export interface ChartSpec {
  title: string;
  labels: string[];
  values: number[];
  suffix: string;
  colors?: string[];
}

export interface ReportData {
  title: string;
  typeLabel: string;
  student: Student;
  periodLabel: string;
  range: DateRange;
  authorName: string;
  generatedAt: string;
  include: ReportInclude;
  summary: string;
  subjectsLabel: string;
  metrics: { label: string; value: string; basis: string }[];
  subjectRows: string[][];
  observationRows: string[][];
  noteRows: string[][];
  achievementRows: string[][];
  goals: { goal: IEPGoal; measurements: IEPMeasurement[]; latest: string; met: number }[];
  categoryTables: { title: string; rows: string[][] }[];
  insights: Insight[];
  charts: ChartSpec[];
  isDemo: boolean;
}

const fmtR = (r: { num: number; den: number; pct: number | null }) => (r.pct === null ? 'немає даних' : `${r.pct}%`);
const basis = (r: { num: number; den: number }, what: string) => (r.den ? `${r.num} з ${r.den} ${what}` : 'не оцінювалося');

export async function buildReportData(cfg: ReportConfig): Promise<ReportData> {
  const student = (await db.students.get(cfg.studentId))!;
  const ownerId = student.ownerId;
  const [subjects, strategies, goals] = await Promise.all([
    db.subjects.where('ownerId').equals(ownerId).sortBy('order') as Promise<Subject[]>,
    db.strategies.where('ownerId').equals(ownerId).toArray() as Promise<Strategy[]>,
    db.iepGoals.where('studentId').equals(cfg.studentId).toArray(),
  ]);
  const raw = await loadDataset(cfg.studentId, cfg.range);
  const ds = applyFilters(raw, { subjectIds: cfg.subjectIds });
  const m = computeMetrics(ds);
  const subjName = (id?: string) => subjects.find((s) => s.id === id)?.name ?? '—';
  const typeLabel = REPORT_TYPES.find((t) => t.key === cfg.type)?.label ?? '';

  const metrics = [
    { label: 'Зафіксовано уроків', value: String(m.lessons), basis: 'збережені спостереження' },
    { label: 'Завдань', value: String(m.tasks), basis: 'у спостереженнях' },
    { label: 'Навчальна участь', value: fmtR(m.participation), basis: basis(m.participation, 'завдань з оцінкою участі') },
    { label: 'Завершення завдань', value: fmtR(m.completion), basis: basis(m.completion, 'завдань з відомим результатом') },
    { label: 'Самостійність', value: fmtR(m.independence), basis: basis(m.independence, 'завдань із зазначеною підтримкою') },
    { label: 'Самостійний початок', value: fmtR(m.independentStart), basis: basis(m.independentStart, 'уроків з оцінкою') },
    { label: 'Досягнення', value: String(m.achievements), basis: 'щоденник досягнень' },
  ];

  const rows = bySubject(ds, subjects);
  const subjectRows = rows.map((r) => [r.name, String(r.lessons), String(r.tasks), fmtR(r.completion), fmtR(r.independence), fmtR(r.participation)]);

  const obsSorted = [...ds.observations].sort((a, b) => (a.date === b.date ? (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0) : a.date < b.date ? -1 : 1));
  const observationRows = obsSorted.map((o) => {
    const ts = ds.tasks.filter((t) => t.observationId === o.id);
    const res = ts.length
      ? ts.map((t) => `${t.title || labelOf('taskType', t.type)}: ${t.offered !== null && t.completed !== null ? `${t.completed}/${t.offered} ${t.unit}` : labelOf('taskResult', t.result)}`).join('; ')
      : '—';
    return [
      fmtDate(o.date, 'dd.MM.yyyy'), o.lessonNumber ? String(o.lessonNumber) : '—', subjName(o.subjectId), o.topic || '—',
      o.behaviors.map((b) => labelOf('behaviors', b)).join(', ') || '—', labelOf('engagement', o.engagement),
      o.supportLevels.map((s) => labelOf('support', s)).join(', ') || '—', res,
    ];
  });

  const noteRows = obsSorted
    .filter((o) => o.notes || o.wentWell || o.difficulties || o.helped || o.nextTime)
    .map((o) => [
      `${fmtDate(o.date, 'dd.MM')} · ${subjName(o.subjectId)}`,
      [o.notes, o.wentWell && `Вдалося: ${o.wentWell}`, o.difficulties && `Труднощі: ${o.difficulties}`, o.helped && `Допомогло: ${o.helped}`, o.nextTime && `Наступного разу: ${o.nextTime}`].filter(Boolean).join('\n'),
    ]);

  const achievementRows = ds.achievements
    .filter((a) => a.includeInReports)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((a) => [fmtDate(a.date, 'dd.MM.yyyy'), labelOf('achievement', a.category), a.title, a.description || '']);

  const goalBlocks = [];
  for (const g of goals) {
    const ms = (await db.iepMeasurements.where('goalId').equals(g.id).sortBy('date')).filter((x) => x.date <= cfg.range.to);
    const last = ms[ms.length - 1];
    goalBlocks.push({
      goal: g,
      measurements: ms.filter((x) => x.date >= cfg.range.from),
      latest: last ? `${fmtDate(last.date, 'dd.MM.yyyy')}: ${last.value ?? ''} ${last.value !== null ? g.unit : ''}${last.comment ? ` — ${last.comment}` : ''}`.trim() : 'вимірювань немає',
      met: ms.filter((x) => x.criterionMet).length,
    });
  }

  const supportTotal = [...m.supportCounts.values()].reduce((a, b) => a + b, 0);
  const behTotal = m.lessons;
  const categoryTables = [
    { title: 'Рівні підтримки (завдання)', rows: SUPPORT_LEVELS.filter((s) => m.supportCounts.get(s.key)).map((s) => [s.label, String(m.supportCounts.get(s.key)), `${Math.round((m.supportCounts.get(s.key)! / supportTotal) * 100)}%`]) },
    { title: 'Поведінкові прояви (кількість уроків)', rows: [...m.behaviorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [labelOf('behaviors', k), String(v), `з ${behTotal}`]) },
    { title: 'Стратегії підтримки', rows: [...strategyStats(ds.strategyUses).values()].sort((a, b) => b.uses - a.uses).map((s) => [strategies.find((x) => x.id === s.strategyId)?.name ?? '—', String(s.uses), s.assessed ? `допомогла: ${s.helped} з ${s.assessed}` : 'не оцінено']) },
  ].filter((t) => t.rows.length);

  const charts: ChartSpec[] = [];
  if (rows.length) {
    const withPct = rows.filter((r) => r.completion.pct !== null);
    if (withPct.length) charts.push({ title: 'Завершення завдань за предметами, %', labels: withPct.map((r) => r.name), values: withPct.map((r) => r.completion.pct!), suffix: '%', colors: withPct.map((r) => r.color) });
  }
  if (supportTotal) {
    const sl = SUPPORT_LEVELS.filter((s) => m.supportCounts.get(s.key));
    charts.push({ title: 'Використана підтримка (кількість завдань)', labels: sl.map((s) => s.label), values: sl.map((s) => m.supportCounts.get(s.key)!), suffix: '' });
  }

  const insights = generateInsights(ds, null, { subjects, strategies });
  const filteredSubjects = cfg.subjectIds.length ? cfg.subjectIds.map(subjName).join(', ') : 'усі предмети';

  return {
    title: `Звіт педагогічних спостережень — ${typeLabel.toLowerCase()}`,
    typeLabel,
    student,
    periodLabel: cfg.range.from === cfg.range.to ? fmtDate(cfg.range.from) : `${fmtDate(cfg.range.from)} — ${fmtDate(cfg.range.to)}`,
    range: cfg.range,
    authorName: cfg.authorName,
    generatedAt: fmtDate(new Date().toISOString().slice(0, 10)),
    include: cfg.include,
    summary: summaryText(ds, { subjects, strategies, studentName: student.name, range: cfg.range }),
    subjectsLabel: filteredSubjects,
    metrics,
    subjectRows,
    observationRows,
    noteRows,
    achievementRows,
    goals: goalBlocks,
    categoryTables,
    insights,
    charts,
    isDemo: !!student.isDemo,
  };
}

export const SUBJECT_HEAD = ['Предмет', 'Уроків', 'Завдань', 'Завершення', 'Самостійність', 'Участь'];
export const OBS_HEAD = ['Дата', '№', 'Предмет', 'Тема', 'Поведінка', 'Залученість', 'Підтримка', 'Результат'];
export const ACH_HEAD = ['Дата', 'Категорія', 'Досягнення', 'Опис'];
export const achievementCategoryLabel = (k: string) => ACHIEVEMENT_CATEGORIES.find((c) => c.key === k)?.label ?? k;
