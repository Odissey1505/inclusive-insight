import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek,
} from 'date-fns';
import { uk } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, BarChart3, Pencil, Eye, Circle, CheckCircle, FileClock } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { useDataset } from '../hooks/useData';
import { lessonsRepo } from '../db/repositories';
import { db } from '../db/database';
import { applyFilters, heatmap, HEAT_METRICS, type HeatMetric } from '../analytics/engine';
import { Badge, Button, Card, EmptyState, IconButton, PageHeader, PageSkeleton, Segmented, Select } from '../components/ui';
import { LessonModal } from '../components/shared/LessonModal';
import { cn, fmtDate, todayISO, toISO } from '../lib/utils';
import { labelOf } from '../lib/catalog';
import type { Lesson, Observation } from '../types/models';

type View = 'day' | 'week' | 'month';

export default function CalendarPage() {
  const { student, subjects, subjectName, subjectColor } = useSession();
  const nav = useNavigate();
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'day' : 'month'));
  const [cursor, setCursor] = useState(todayISO());
  const [selected, setSelected] = useState(todayISO());
  const [metric, setMetric] = useState<HeatMetric>('records');
  const [subjectId, setSubjectId] = useState('');
  const [lessonModal, setLessonModal] = useState<{ open: boolean; lesson?: Lesson | null; date: string }>({ open: false, date: todayISO() });

  const c = parseISO(cursor);
  const range = useMemo(() => {
    if (view === 'month') return { from: toISO(startOfWeek(startOfMonth(c), { weekStartsOn: 1 })), to: toISO(endOfWeek(endOfMonth(c), { weekStartsOn: 1 })) };
    if (view === 'week') return { from: toISO(startOfWeek(c, { weekStartsOn: 1 })), to: toISO(endOfWeek(c, { weekStartsOn: 1 })) };
    return { from: cursor, to: cursor };
  }, [view, cursor]); // eslint-disable-line
  const ds = useDataset(student!.id, range);
  const lessons = useLiveQuery(() => lessonsRepo.listRange(student!.id, range.from, range.to), [student!.id, range.from, range.to]);
  const drafts = useLiveQuery(() => db.observations.where('[studentId+date]').between([student!.id, range.from], [student!.id, range.to], true, true).filter((o) => o.status === 'draft').toArray(), [student!.id, range.from, range.to]);

  const filtered = useMemo(() => (ds ? applyFilters(ds, { subjectIds: subjectId ? [subjectId] : [] }) : null), [ds, subjectId]);
  const heat = useMemo(() => (filtered ? heatmap(filtered, metric) : new Map()), [filtered, metric]);
  if (!filtered || !lessons || !drafts) return <PageSkeleton />;

  const metaDef = HEAT_METRICS.find((m) => m.key === metric)!;
  const maxCount = Math.max(1, ...[...heat.values()].map((v) => v.value));
  const level = (v: number) => {
    const t = metaDef.isPct ? v / 100 : v / maxCount;
    return Math.min(6, Math.max(1, Math.ceil(t * 6)));
  };
  const allObs: Observation[] = [...filtered.observations, ...drafts.filter((d) => !subjectId || d.subjectId === subjectId)];
  const dayItems = (d: string) => {
    const obs = allObs.filter((o) => o.date === d);
    const ls = lessons.filter((l) => l.date === d && (!subjectId || l.subjectId === subjectId));
    const rows = ls.map((l) => ({ key: l.id, number: l.number, subjectId: l.subjectId, topic: l.topic, lesson: l as Lesson | undefined, obs: obs.find((o) => o.lessonId === l.id) }));
    for (const o of obs) if (!rows.some((r) => r.obs?.id === o.id)) rows.push({ key: o.id, number: o.lessonNumber ?? 0, subjectId: o.subjectId, topic: o.topic, lesson: undefined, obs: o });
    return rows.sort((a, b) => a.number - b.number);
  };

  const shift = (dir: 1 | -1) => {
    const n = view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : addDays(c, dir);
    setCursor(toISO(n));
    if (view === 'day') setSelected(toISO(n));
  };
  const title = view === 'month' ? format(c, 'LLLL yyyy', { locale: uk }) : view === 'week' ? `${fmtDate(range.from, 'd MMM')} — ${fmtDate(range.to, 'd MMM yyyy')}` : fmtDate(cursor, 'EEEE, d MMMM yyyy');

  const DayPanel = ({ d }: { d: string }) => {
    const items = dayItems(d);
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold capitalize">{fmtDate(d, 'EEEE, d MMMM')}</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLessonModal({ open: true, lesson: null, date: d })}>Урок</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => nav(`/observation/new?date=${d}`)}>Запис</Button>
          </div>
        </div>
        {items.length === 0 ? <p className="rounded-xl bg-bg p-4 text-center text-sm text-muted">Записів за цей день немає.</p> : (
          <ul className="space-y-2">
            {items.map((r) => (
              <li key={r.key} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: subjectColor(r.subjectId) }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.number ? `${r.number}. ` : ''}{subjectName(r.subjectId)}</div>
                  <div className="truncate text-xs text-muted">{r.topic || (r.obs ? labelOf('engagement', r.obs.engagement) : 'Не заповнено')}</div>
                </div>
                {!r.obs ? <Circle className="h-4 w-4 text-muted" aria-label="Не заповнено" /> : r.obs.status === 'draft' ? <FileClock className="h-4 w-4 text-sun-dark" aria-label="Чернетка" /> : <CheckCircle className="h-4 w-4 text-mint-dark" aria-label="Заповнено" />}
                {r.obs ? (
                  <>
                    <IconButton label="Переглянути" onClick={() => nav(`/journal/${r.obs!.id}`)}><Eye className="h-4 w-4" /></IconButton>
                    <IconButton label="Редагувати" onClick={() => nav(`/observation/${r.obs!.id}/edit`)}><Pencil className="h-4 w-4" /></IconButton>
                  </>
                ) : (
                  <>
                    <IconButton label="Редагувати урок" onClick={() => setLessonModal({ open: true, lesson: r.lesson, date: d })}><Pencil className="h-4 w-4" /></IconButton>
                    <Button size="sm" onClick={() => nav(`/observation/new?lesson=${r.lesson!.id}`)}>Заповнити</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const cellStyle = (d: string) => {
    const h = heat.get(d);
    return h ? { background: `var(--seq-${level(h.value)})` } : undefined;
  };
  const cellTextDark = (d: string) => {
    const h = heat.get(d);
    return h && level(h.value) >= 4;
  };

  return (
    <div className="animate-in">
      <PageHeader title="Календар" icon={<CalendarDays className="h-5 w-5" />} subtitle="Уроки, записи та теплова карта показників"
        actions={<Button variant="secondary" icon={<BarChart3 className="h-4 w-4" />} onClick={() => nav(`/analytics?from=${range.from}&to=${range.to}`)}>Аналітика за період</Button>} />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <IconButton label="Назад" onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" /></IconButton>
            <IconButton label="Вперед" onClick={() => shift(1)}><ChevronRight className="h-5 w-5" /></IconButton>
            <h2 className="min-w-[200px] text-lg font-bold capitalize">{title}</h2>
            <Button size="sm" variant="ghost" onClick={() => { setCursor(todayISO()); setSelected(todayISO()); }}>Сьогодні</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Предмет" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-auto">
              <option value="">Усі предмети</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Segmented<View> value={view} onChange={(v) => { setView(v); if (v === 'day') setCursor(selected); }} options={[{ key: 'day', label: 'День' }, { key: 'week', label: 'Тиждень' }, { key: 'month', label: 'Місяць' }]} />
          </div>
        </div>
        {view !== 'day' && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
            <span className="font-semibold text-muted">Теплова карта:</span>
            <Segmented<HeatMetric> size="sm" value={metric} onChange={setMetric} options={HEAT_METRICS.map((m) => ({ key: m.key, label: m.label }))} />
            <span className="ml-auto flex items-center gap-1.5 text-muted">
              {metaDef.isPct ? '0%' : 'менше'}
              {[1, 2, 3, 4, 5, 6].map((i) => <span key={i} className="h-3 w-5 rounded" style={{ background: `var(--seq-${i})` }} />)}
              {metaDef.isPct ? '100%' : 'більше'}
              <span className="ml-2 h-3 w-5 rounded border border-dashed border-line bg-bg" /> немає даних
            </span>
          </div>
        )}
      </Card>

      {view === 'month' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="p-2 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted sm:gap-2">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {eachDayOfInterval({ start: parseISO(range.from), end: parseISO(range.to) }).map((day) => {
                const d = toISO(day);
                const items = dayItems(d);
                const h = heat.get(d);
                const dark = cellTextDark(d);
                return (
                  <button key={d} onClick={() => setSelected(d)} onDoubleClick={() => { setCursor(d); setView('day'); }}
                    title={h ? `${metaDef.label}: ${h.value}${metaDef.isPct ? '%' : ''} (n=${h.n})` : 'Немає даних'}
                    className={cn('focus-ring flex aspect-square flex-col items-start justify-between rounded-xl border p-1.5 text-left transition sm:aspect-[1.15] sm:p-2',
                      !isSameMonth(day, c) && 'opacity-40', selected === d ? 'border-primary ring-2 ring-primary/30' : h ? 'border-transparent' : 'border-dashed border-line bg-bg/50')}
                    style={cellStyle(d)}>
                    <span className={cn('text-xs font-bold sm:text-sm', d === todayISO() && 'rounded-md bg-ink px-1 text-card', dark && d !== todayISO() && 'seq-on-high')}>{day.getDate()}</span>
                    {items.length > 0 && <span className={cn('text-[10px] font-semibold sm:text-xs', dark ? 'seq-on-high' : 'text-ink')}>{items.filter((i) => i.obs?.status === 'final').length}/{items.length}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-xs text-muted">Число в клітинці — заповнено / усього уроків. Подвійний клік відкриває день. Кольори показують величину показника, а не оцінку дня.</p>
          </Card>
          <Card><DayPanel d={selected} /></Card>
        </div>
      )}

      {view === 'week' && (
        <div className="grid gap-3 md:grid-cols-7">
          {eachDayOfInterval({ start: parseISO(range.from), end: parseISO(range.to) }).map((day) => {
            const d = toISO(day);
            const items = dayItems(d);
            const h = heat.get(d);
            return (
              <div key={d} className={cn('card flex min-h-[160px] flex-col p-3', d === todayISO() && 'ring-2 ring-primary/40')}>
                <button className="mb-2 flex items-center justify-between text-left" onClick={() => { setCursor(d); setSelected(d); setView('day'); }}>
                  <span className="text-sm font-bold capitalize">{format(day, 'EEEEEE, d', { locale: uk })}</span>
                  {h && <span className="rounded-md px-1.5 text-[11px] font-bold" style={{ background: `var(--seq-${level(h.value)})`, color: level(h.value) >= 4 ? 'var(--seq-on-high)' : undefined }}>{h.value}{metaDef.isPct ? '%' : ''}</span>}
                </button>
                <div className="flex-1 space-y-1.5">
                  {items.map((r) => (
                    <button key={r.key} onClick={() => (r.obs ? nav(`/journal/${r.obs.id}`) : nav(`/observation/new?lesson=${r.lesson!.id}`))}
                      className="flex w-full items-center gap-1.5 rounded-lg bg-bg px-2 py-1.5 text-left text-xs hover:bg-primary-soft">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(r.subjectId) }} />
                      <span className="flex-1 truncate">{r.number ? `${r.number}. ` : ''}{subjectName(r.subjectId)}</span>
                      {r.obs?.status === 'draft' ? <Badge tone="sun">ч</Badge> : !r.obs && <Circle className="h-3 w-3 text-muted" />}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => nav(`/observation/new?date=${d}`)}>Запис</Button>
              </div>
            );
          })}
        </div>
      )}

      {view === 'day' && <Card><DayPanel d={cursor} /></Card>}

      {filtered.observations.length === 0 && lessons.length === 0 && view !== 'day' && (
        <Card className="mt-4"><EmptyState icon={<CalendarDays className="h-7 w-7" />} title="У цьому періоді записів немає" text="Оберіть день і додайте урок або спостереження." /></Card>
      )}

      <LessonModal open={lessonModal.open} lesson={lessonModal.lesson} date={lessonModal.date}
        nextNumber={Math.max(0, ...lessons.filter((l) => l.date === lessonModal.date).map((l) => l.number)) + 1}
        onClose={() => setLessonModal((s) => ({ ...s, open: false }))} />
    </div>
  );
}
