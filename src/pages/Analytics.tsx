import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { eachDayOfInterval, parseISO, startOfWeek, differenceInCalendarDays, format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  BarChart3, Lightbulb, Activity, CheckCircle2, Footprints, Play, BookOpen, Award, Info, Sparkles, TrendingUp, Clock, ExternalLink, AlertTriangle,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useSession } from '../hooks/useApp';
import { useDataset } from '../hooks/useData';
import {
  PERIODS, applyFilters, bySubject, comparePeriods, computeMetrics, generateInsights, heatmap, periodRange, previousRange, timeSeries,
  timeline, HEAT_METRICS, type PeriodKey, type HeatMetric, type Ratio, type DateRange,
} from '../analytics/engine';
import { BEHAVIORS, ENGAGEMENT, EVENT_TYPES, SUPPORT_LEVELS, TASK_TYPES, labelOf } from '../lib/catalog';
import { Badge, Card, EmptyState, Input, PageHeader, PageSkeleton, Segmented, Select, StatCard } from '../components/ui';
import { BarsChart, DataTable, DonutChart, LegendRow, SERIES, StackedChart, TrendChart } from '../components/charts';
import { cn, fmtDate, fmtPct } from '../lib/utils';
import { JournalKeeping } from '../components/schedule/JournalKeeping';

const hint = (r: Ratio, what: string) => (r.den ? `${r.num} з ${r.den} ${what}${r.lowData ? ' · мало даних' : ''}` : 'не оцінювалося');

type SubjMetric = 'completion' | 'independence' | 'participation' | 'engagement';
type DonutKind = 'engagement' | 'behaviors' | 'events';

export default function Analytics() {
  const { student, subjects, strategies } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<PeriodKey>(params.get('from') ? 'custom' : 'last30');
  const [custom, setCustom] = useState<DateRange>({ from: params.get('from') ?? periodRange('last30').from, to: params.get('to') ?? periodRange('last30').to });
  const [subjectId, setSubjectId] = useState('');
  const [taskType, setTaskType] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [behavior, setBehavior] = useState('');
  const [subjMetric, setSubjMetric] = useState<SubjMetric>('completion');
  const [donut, setDonut] = useState<DonutKind>('engagement');
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('participation');

  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const prevRange = useMemo(() => previousRange(range), [range]);
  const rawCur = useDataset(student!.id, range);
  const rawPrev = useDataset(student!.id, prevRange);
  const filters = { subjectIds: subjectId ? [subjectId] : [], taskType: taskType || null, strategyId: strategyId || null, behavior: behavior || null };
  const cur = useMemo(() => (rawCur ? applyFilters(rawCur, filters) : null), [rawCur, subjectId, taskType, strategyId, behavior]); // eslint-disable-line
  const prev = useMemo(() => (rawPrev ? applyFilters(rawPrev, filters) : null), [rawPrev, subjectId, taskType, strategyId, behavior]); // eslint-disable-line

  if (!cur || !prev) return <PageSkeleton />;

  const m = computeMetrics(cur);
  const series = timeSeries(cur, range);
  const subjRows = bySubject(cur, subjects);
  const insights = generateInsights(cur, prev, { subjects, strategies });
  const comparison = comparePeriods(cur, prev);
  const heat = heatmap(cur, heatMetric);
  const tl = timeline(cur, subjects).slice(0, 30);
  const journalLink = (r: DateRange, subj?: string) => `/journal?from=${r.from}&to=${r.to}${subj ? `&subject=${subj}` : ''}`;
  const rangeLen = differenceInCalendarDays(parseISO(range.to), parseISO(range.from)) + 1;

  const donutData = donut === 'engagement'
    ? ENGAGEMENT.filter((e) => m.engagementCounts.get(e.key)).map((e) => ({ name: e.label, value: m.engagementCounts.get(e.key)! }))
    : donut === 'events'
      ? EVENT_TYPES.filter((e) => m.eventCounts.get(e.key)).map((e) => ({ name: e.label, value: m.eventCounts.get(e.key)! }))
      : (() => {
        const sorted = [...m.behaviorCounts.entries()].sort((a, b) => b[1] - a[1]);
        const topN = sorted.slice(0, 6).map(([k, v]) => ({ name: labelOf('behaviors', k), value: v }));
        const rest = sorted.slice(6).reduce((a, [, v]) => a + v, 0);
        return rest ? [...topN, { name: 'Інше', value: rest }] : topN;
      })();

  const stackData = subjRows.map((r) => ({ name: r.name, ...r.support }));
  const subjBars = subjRows.map((r) => ({ name: r.name, value: r[subjMetric].pct, basis: `n = ${r[subjMetric].den}`, subjectId: r.subjectId }));
  const SHORT: Record<string, string> = { 'Навчальна участь': 'Участь', 'Завершення завдань': 'Завершення', 'Самостійний початок': 'Сам. початок', 'Активна залученість': 'Залученість' };
  const compareData = comparison.map((c) => ({ name: SHORT[c.label] ?? c.label, 'Поточний': c.a.pct, 'Попередній': c.b.pct }));

  return (
    <div className="animate-in space-y-5">
      <PageHeader title="Аналітичний центр" icon={<BarChart3 className="h-5 w-5" />} subtitle={`${student!.name} · ${fmtDate(range.from)} — ${fmtDate(range.to)}`} />

      {/* Filters */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
            <Segmented<PeriodKey> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p.key, label: p.label }))} className="flex-nowrap whitespace-nowrap" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {period === 'custom' && (
              <>
                <Input label="Від" type="date" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
                <Input label="До" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
              </>
            )}
            <Select label="Предмет" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Усі</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label="Тип завдання" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              <option value="">Усі</option>{TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
            <Select label="Категорія (поведінка)" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
              <option value="">Усі</option>{BEHAVIORS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
            <Select label="Стратегія підтримки" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              <option value="">Усі</option>{strategies.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {m.lessons === 0 ? (
        <Card><EmptyState icon={<BarChart3 className="h-7 w-7" />} title="За обраний період немає даних" text="Змініть період чи фільтри або додайте спостереження. Чернетки в аналітиці не враховуються." /></Card>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Уроків" value={m.lessons} icon={<BookOpen className="h-4 w-4" />} hint={`${m.tasks} завдань`} />
            <StatCard label="Участь" value={fmtPct(m.participation.pct)} icon={<Activity className="h-4 w-4" />} hint={hint(m.participation, 'завдань')} lowData={m.participation.lowData} />
            <StatCard label="Завершення" value={fmtPct(m.completion.pct)} icon={<CheckCircle2 className="h-4 w-4" />} tone="mint" hint={hint(m.completion, 'завдань')} lowData={m.completion.lowData} />
            <StatCard label="Самостійність" value={fmtPct(m.independence.pct)} icon={<Footprints className="h-4 w-4" />} tone="sun" hint={hint(m.independence, 'завдань')} lowData={m.independence.lowData} />
            <StatCard label="Сам. початок" value={fmtPct(m.independentStart.pct)} icon={<Play className="h-4 w-4" />} tone="blue" hint={hint(m.independentStart, 'уроків')} lowData={m.independentStart.lowData} />
            <StatCard label="Досягнення" value={m.achievements} icon={<Award className="h-4 w-4" />} tone="coral" hint="задокументовано" />
          </div>

          {/* Insights */}
          <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-5 w-5 text-sun-dark" />Smart Insights</span>}
            subtitle="Висновки за правилами (Rule-Based Analytics Engine), не штучний інтелект. Збіг у часі не означає причинно-наслідкового зв'язку.">
            <ul className="grid gap-2 md:grid-cols-2">
              {insights.map((i) => (
                <li key={i.id} className={cn('flex gap-3 rounded-2xl p-3 text-sm', i.tone === 'positive' ? 'bg-mint-soft' : i.tone === 'warning' ? 'bg-sun-soft' : i.tone === 'info' ? 'bg-primary-soft' : 'bg-bg')}>
                  {i.tone === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sun-dark" /> : i.tone === 'positive' ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-mint-dark" /> : <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  <span><span className="block">{i.text}</span><span className="text-xs text-muted">Основа: {i.basis}</span></span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Smart Schedule: administrative journal-keeping indicators (separate from learning metrics) */}
          <JournalKeeping studentId={student!.id} from={range.from} to={range.to} />

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Динаміка навчальної участі" subtitle={`${rangeLen > 31 ? 'За тижнями' : 'За днями'} · порожні проміжки = немає даних (не нуль). Клік по точці відкриває записи.`}>
              <TrendChart data={series} series={[
                { key: 'participation', label: 'Участь', color: SERIES[0] },
                { key: 'completion', label: 'Завершення', color: SERIES[2] },
                { key: 'independence', label: 'Самостійність', color: SERIES[6] },
              ]} onPointClick={(p) => nav(journalLink({ from: p.from, to: p.to }, subjectId))} />
              <DataTable head={['Період', 'Уроків', 'Участь', 'Завершення', 'Самостійність']} rows={series.filter((s) => s.lessons).map((s) => [s.label, s.lessons, fmtPct(s.participation), fmtPct(s.completion), fmtPct(s.independence)])} />
            </Card>

            <Card title="Порівняння предметів" subtitle="Клік по стовпцю відкриває записи предмета"
              action={<Select aria-label="Показник" value={subjMetric} onChange={(e) => setSubjMetric(e.target.value as SubjMetric)} className="w-auto py-1.5 text-sm">
                <option value="completion">Завершення</option><option value="independence">Самостійність</option><option value="participation">Участь</option><option value="engagement">Активна залученість</option>
              </Select>}>
              <BarsChart data={subjBars} dataKey="value" unit="%" max={100} onBarClick={(r) => nav(journalLink(range, r.subjectId))} />
              <DataTable head={['Предмет', 'Уроків', 'Завдань', 'Значення', 'n']} rows={subjRows.map((r) => [r.name, r.lessons, r.tasks, fmtPct(r[subjMetric].pct), r[subjMetric].den])} />
            </Card>

            <Card title="Рівні підтримки за предметами" subtitle="Кількість завдань з кожним видом підтримки">
              <StackedChart data={stackData} keys={SUPPORT_LEVELS.map((s) => ({ key: s.key, label: s.label }))} />
            </Card>

            <Card title="Розподіл категорій"
              action={<Segmented<DonutKind> size="sm" value={donut} onChange={setDonut} options={[{ key: 'engagement', label: 'Залученість' }, { key: 'behaviors', label: 'Поведінка' }, { key: 'events', label: 'Події' }]} />}>
              <DonutChart data={donutData} height={260} />
              <DataTable head={['Категорія', 'Кількість']} rows={donutData.map((d) => [d.name, d.value])} />
            </Card>

            <Card title="Порівняння з попереднім періодом" subtitle={`${fmtDate(prevRange.from, 'd MMM')} — ${fmtDate(prevRange.to, 'd MMM')} vs поточний`}>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={compareData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="24%">
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgb(var(--c-muted))' }} interval={0} tickLine={false} stroke="rgb(var(--c-line))" />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: 'rgb(var(--c-muted))' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-line))', borderRadius: 12 }} formatter={(v: any) => (v === null ? '—' : `${v}%`)} />
                    <Bar dataKey="Попередній" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="Поточний" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <LegendRow items={[{ label: 'Попередній період', color: SERIES[1] }, { label: 'Поточний період', color: SERIES[0] }]} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted"><tr><th className="py-1 text-left">Показник</th><th>Попередній</th><th>Поточний</th><th>Різниця</th></tr></thead>
                  <tbody>{comparison.map((c) => (
                    <tr key={c.metric} className="border-t border-line">
                      <td className="py-1.5">{c.label}</td>
                      <td className="text-center">{fmtPct(c.b.pct)} <span className="text-muted">({c.b.den})</span></td>
                      <td className="text-center">{fmtPct(c.a.pct)} <span className="text-muted">({c.a.den})</span></td>
                      <td className="text-center font-semibold">{c.diff === null ? '—' : `${c.diff > 0 ? '+' : ''}${c.diff} п.п.`}{(c.a.lowData || c.b.lowData) && c.diff !== null && <Badge tone="sun" className="ml-1">мало даних</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>

            <Card title="Теплова карта" subtitle="Дні без даних — нейтральні. Колір відображає величину, а не оцінку дня."
              action={<Select aria-label="Показник" value={heatMetric} onChange={(e) => setHeatMetric(e.target.value as HeatMetric)} className="w-auto py-1.5 text-sm">
                {HEAT_METRICS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
              </Select>}>
              <HeatGrid range={range} heat={heat} isPct={!!HEAT_METRICS.find((h) => h.key === heatMetric)?.isPct} onDay={(d) => nav(journalLink({ from: d, to: d }))} />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title={<span className="inline-flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Хронологія подій</span>} subtitle="Події, досягнення та нотатки">
              {tl.length === 0 ? <p className="text-sm text-muted">Подій за період немає.</p> : (
                <ol className="relative space-y-3 border-l-2 border-line pl-5">
                  {tl.map((t, i) => (
                    <li key={i} className="relative">
                      <span className={cn('absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-card', t.kind === 'achievement' ? 'bg-sun-dark' : t.kind === 'event' ? 'bg-primary' : 'bg-mint-dark')} />
                      <div className="text-xs text-muted">{fmtDate(t.date)} · {t.kind === 'achievement' ? 'досягнення' : t.kind === 'event' ? 'подія' : 'нотатка'}</div>
                      <div className="text-sm font-semibold">{t.title}</div>
                      {t.detail && <div className="line-clamp-2 text-sm text-muted">{t.detail}</div>}
                      {t.kind !== 'achievement' && <Link to={`/journal/${t.refId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Відкрити запис <ExternalLink className="h-3 w-3" /></Link>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Обсяг виконаного за одиницями" subtitle="Підсумовується лише в межах однієї одиниці вимірювання">
              {m.volumeByUnit.length === 0 ? <p className="text-sm text-muted">Немає завдань із кількісними даними.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="py-1.5 text-left">Одиниця</th><th>Завдань</th><th>Запропоновано</th><th>Виконано</th><th>Частка</th></tr></thead>
                  <tbody>{m.volumeByUnit.map((u) => (
                    <tr key={u.unit} className="border-t border-line text-center">
                      <td className="py-2 text-left font-semibold">{u.unit}</td><td>{u.tasks}</td><td>{u.offered}</td><td>{u.completed}</td>
                      <td>{u.offered ? `${Math.round((u.completed / u.offered) * 100)}%` : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-bg p-3 text-xs text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Відсотки рахуються лише з оцінених записів: пропущені значення не вважаються нулями. Поруч із кожним показником вказано кількість спостережень (n).</span>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function HeatGrid({ range, heat, isPct, onDay }: { range: DateRange; heat: Map<string, { value: number; n: number }>; isPct: boolean; onDay: (d: string) => void }) {
  const days = eachDayOfInterval({ start: parseISO(range.from), end: parseISO(range.to) });
  if (days.length > 400) return <p className="text-sm text-muted">Оберіть коротший період.</p>;
  const max = Math.max(1, ...[...heat.values()].map((v) => v.value));
  const lvl = (v: number) => Math.min(6, Math.max(1, Math.ceil((isPct ? v / 100 : v / max) * 6)));
  const start = startOfWeek(days[0], { weekStartsOn: 1 });
  const cols: (Date | null)[][] = [];
  let cur: (Date | null)[] = [];
  for (let d = start; d <= days[days.length - 1]; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    cur.push(d < days[0] ? null : d);
    if (cur.length === 7) { cols.push(cur); cur = []; }
  }
  if (cur.length) cols.push(cur);
  const iso = (d: Date) => format(d, 'yyyy-MM-dd');
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-thin">
        <div className="mr-1 flex flex-col gap-1 pt-5 text-[10px] text-muted">{['Пн', '', 'Ср', '', 'Пт', '', 'Нд'].map((d, i) => <span key={i} className="h-4 leading-4">{d}</span>)}</div>
        {cols.map((col, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="h-4 text-[10px] text-muted">{col[0] && col[0].getDate() <= 7 ? format(col[0], 'LLL', { locale: uk }) : ''}</span>
            {col.map((d, j) => {
              if (!d) return <span key={j} className="h-4 w-4" />;
              const h = heat.get(iso(d));
              return (
                <button key={j} onClick={() => h && onDay(iso(d))} disabled={!h}
                  title={`${fmtDate(iso(d))}: ${h ? `${h.value}${isPct ? '%' : ''} (n=${h.n})` : 'немає даних'}`}
                  className={cn('h-4 w-4 rounded-[4px]', !h && 'border border-dashed border-line bg-bg')}
                  style={h ? { background: `var(--seq-${lvl(h.value)})` } : undefined} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        {isPct ? '0%' : 'менше'}{[1, 2, 3, 4, 5, 6].map((i) => <span key={i} className="h-3 w-4 rounded" style={{ background: `var(--seq-${i})` }} />)}{isPct ? '100%' : 'більше'}
      </div>
    </div>
  );
}
