import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek,
} from 'date-fns';
import { uk } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, BarChart3, Circle, CalendarOff, Settings2, Ban, Sparkles, PenLine } from 'lucide-react';
import { DayEditor, DayLessons, LessonActions } from '../components/schedule';
import { useScheduleRange } from '../schedule/useSchedule';
import type { DaySchedule, ResolvedLesson } from '../schedule/scheduleEngine';
import { useSession } from '../hooks/useApp';
import { useDataset } from '../hooks/useData';
import { lessonsRepo } from '../db/repositories';
import { applyFilters, heatmap, HEAT_METRICS, type HeatMetric } from '../analytics/engine';
import { Badge, Button, Card, EmptyState, IconButton, PageHeader, PageSkeleton, Segmented, Select } from '../components/ui';
import { LessonModal } from '../components/shared/LessonModal';
import { cn, fmtDate, todayISO, toISO } from '../lib/utils';
import type { Lesson } from '../types/models';

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
  const [active, setActive] = useState<{ lesson: ResolvedLesson; day: DaySchedule } | null>(null);
  const [editDay, setEditDay] = useState<string | null>(null);

  const c = parseISO(cursor);
  const range = useMemo(() => {
    if (view === 'month') return { from: toISO(startOfWeek(startOfMonth(c), { weekStartsOn: 1 })), to: toISO(endOfWeek(endOfMonth(c), { weekStartsOn: 1 })) };
    if (view === 'week') return { from: toISO(startOfWeek(c, { weekStartsOn: 1 })), to: toISO(endOfWeek(c, { weekStartsOn: 1 })) };
    return { from: cursor, to: cursor };
  }, [view, cursor]); // eslint-disable-line
  const ds = useDataset(student!.id, range);
  const lessons = useLiveQuery(() => lessonsRepo.listRange(student!.id, range.from, range.to), [student!.id, range.from, range.to]);
  // Lessons of each date: Smart Schedule (template + exceptions) + manual lessons + observations.
  const sched = useScheduleRange(student!.id, range.from, range.to);

  const filtered = useMemo(() => (ds ? applyFilters(ds, { subjectIds: subjectId ? [subjectId] : [] }) : null), [ds, subjectId]);
  const heat = useMemo(() => (filtered ? heatmap(filtered, metric) : new Map()), [filtered, metric]);
  if (!filtered || !lessons || !sched) return <PageSkeleton />;

  const metaDef = HEAT_METRICS.find((m) => m.key === metric)!;
  const maxCount = Math.max(1, ...[...heat.values()].map((v) => v.value));
  const level = (v: number) => {
    const t = metaDef.isPct ? v / 100 : v / maxCount;
    return Math.min(6, Math.max(1, Math.ceil(t * 6)));
  };
  const dayOf = (d: string): DaySchedule => sched.find((x) => x.date === d) ?? { date: d, weekday: 1, period: null, state: 'no-period', dayOverride: null, lessons: [] };
  const dayItems = (d: string) => (subjectId ? dayOf(d).lessons.filter((l) => l.subjectId === subjectId) : dayOf(d).lessons);
  const countOf = (d: string) => {
    const ls = dayItems(d).filter((l) => !l.cancelled);
    return { done: ls.filter((l) => l.status === 'filled').length, total: ls.length };
  };
  const hasChanges = (d: string) => dayItems(d).some((l) => l.kind === 'changed' || l.kind === 'extra' || l.kind === 'cancelled');

  const shift = (dir: 1 | -1) => {
    const n = view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : addDays(c, dir);
    setCursor(toISO(n));
    if (view === 'day') setSelected(toISO(n));
  };
  const title = view === 'month' ? format(c, 'LLLL yyyy', { locale: uk }) : view === 'week' ? `${fmtDate(range.from, 'd MMM')} — ${fmtDate(range.to, 'd MMM yyyy')}` : fmtDate(cursor, 'EEEE, d MMMM yyyy');

  const DayPanel = ({ d }: { d: string }) => {
    const day = dayOf(d);
    const shown = { ...day, lessons: dayItems(d) };
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold capitalize">{fmtDate(d, 'EEEE, d MMMM')}</h3>
            {day.period && <p className="text-xs text-muted">{day.period.name}</p>}
          </div>
          <div className="flex gap-2">
            {day.period
              ? <Button size="sm" variant="secondary" icon={<Settings2 className="h-4 w-4" />} onClick={() => setEditDay(d)}>Змінити день</Button>
              : <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLessonModal({ open: true, lesson: null, date: d })}>Урок</Button>}
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => nav(`/observation/new?date=${d}`)}>Запис</Button>
          </div>
        </div>
        <DayLessons day={shown} compact />
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
                const h = heat.get(d);
                const dark = cellTextDark(d);
                return (
                  <button key={d} onClick={() => setSelected(d)} onDoubleClick={() => { setCursor(d); setView('day'); }}
                    title={h ? `${metaDef.label}: ${h.value}${metaDef.isPct ? '%' : ''} (n=${h.n})` : 'Немає даних'}
                    className={cn('focus-ring flex aspect-square flex-col items-start justify-between rounded-xl border p-1.5 text-left transition sm:aspect-[1.15] sm:p-2',
                      !isSameMonth(day, c) && 'opacity-40', selected === d ? 'border-primary ring-2 ring-primary/30' : h ? 'border-transparent' : 'border-dashed border-line bg-bg/50')}
                    style={cellStyle(d)}>
                    <span className={cn('text-xs font-bold sm:text-sm', d === todayISO() && 'rounded-md bg-ink px-1 text-card', dark && d !== todayISO() && 'seq-on-high')}>{day.getDate()}</span>
                    <span className={cn('flex w-full items-center justify-between gap-1 text-[10px] font-semibold sm:text-xs', dark ? 'seq-on-high' : 'text-ink')}>
                      {dayOf(d).state === 'day-off' ? <CalendarOff className="h-3.5 w-3.5 opacity-70" aria-label="День без занять" /> : countOf(d).total > 0 ? <span>{countOf(d).done}/{countOf(d).total}</span> : <span />}
                      {hasChanges(d) && <span className="h-2 w-2 rounded-full bg-sun-dark" title="Є зміни розкладу" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-xs text-muted">Число в клітинці — заповнено / уроків за розкладом; жовта крапка — є зміни розкладу; <CalendarOff className="inline h-3 w-3" /> — день без занять. Подвійний клік відкриває день. Кольори показують величину показника, а не оцінку дня.</p>
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
                  {dayOf(d).state === 'day-off' && <p className="rounded-lg bg-bg px-2 py-1.5 text-xs text-muted"><CalendarOff className="mr-1 inline h-3 w-3" />без занять</p>}
                  {items.map((r) => (
                    <button key={r.key} onClick={() => setActive({ lesson: r, day: dayOf(d) })} title={r.kind === 'regular' ? undefined : r.kind === 'changed' ? 'Змінений урок' : r.kind === 'cancelled' ? 'Скасований урок' : r.kind === 'extra' ? 'Додатковий урок' : undefined}
                      className={cn('flex w-full items-center gap-1.5 rounded-lg bg-bg px-2 py-1.5 text-left text-xs hover:bg-primary-soft', r.cancelled && 'opacity-60')}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(r.subjectId) }} />
                      <span className={cn('flex-1 truncate', r.cancelled && 'line-through')}>{r.number ? `${r.number}. ` : ''}{subjectName(r.subjectId)}</span>
                      {r.kind === 'cancelled' ? <Ban className="h-3 w-3 text-coral-dark" /> : r.kind === 'extra' ? <Sparkles className="h-3 w-3 text-mint-dark" /> : r.kind === 'changed' ? <PenLine className="h-3 w-3 text-sun-dark" /> : null}
                      {r.status === 'draft' ? <Badge tone="sun">ч</Badge> : r.status === 'filled' ? <span className="h-2 w-2 rounded-full bg-mint" /> : r.status === 'none' && <Circle className="h-3 w-3 text-muted" />}
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

      {filtered.observations.length === 0 && sched.every((d) => d.lessons.length === 0) && view !== 'day' && (
        <Card className="mt-4"><EmptyState icon={<CalendarDays className="h-7 w-7" />} title="У цьому періоді записів немає" text="Оберіть день і додайте урок або спостереження." /></Card>
      )}

      <LessonModal open={lessonModal.open} lesson={lessonModal.lesson} date={lessonModal.date}
        nextNumber={Math.max(0, ...lessons.filter((l) => l.date === lessonModal.date).map((l) => l.number)) + 1}
        onClose={() => setLessonModal((s) => ({ ...s, open: false }))} />
      <LessonActions lesson={active?.lesson ?? null} day={active?.day ?? null} onClose={() => setActive(null)} />
      <DayEditor day={editDay ? dayOf(editDay) : null} onClose={() => setEditDay(null)} onOpenLesson={(l) => { setEditDay(null); setActive({ lesson: l, day: dayOf(l.date) }); }} />
    </div>
  );
}
