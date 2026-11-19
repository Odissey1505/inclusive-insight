import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarClock, ChevronLeft, ChevronRight, Plus, Copy, Archive, ArchiveRestore, Pencil, Trash2, CalendarRange, Clock, Settings2, CalendarOff,
} from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, PageSkeleton, Segmented } from '../components/ui';
import { useToast } from '../components/ui/feedback';
import { DayEditor, DayLessons, KindMark, LessonActions } from '../components/schedule';
import { useScheduleRange } from '../schedule/useSchedule';
import { scheduleRepo } from '../schedule/scheduleRepo';
import {
  addDaysISO, DAY_OFF_LABELS, localTodayISO, timeRange, weekStartISO, WEEKDAYS, type DaySchedule, type ResolvedLesson,
} from '../schedule/scheduleEngine';
import { cn, fmtDate } from '../lib/utils';
import type { SchedulePeriod } from '../types/models';

type Tab = 'week' | 'manage';

export default function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'week';
  const { student } = useSession();
  const nav = useNavigate();
  const periods = useLiveQuery(() => scheduleRepo.listPeriods(student!.id), [student!.id]);
  if (!periods) return <PageSkeleton />;
  return (
    <div className="animate-in">
      <PageHeader title="Розклад" subtitle={`Сталий тижневий розклад · ${student!.name}`} icon={<CalendarClock className="h-5 w-5" />}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/schedule/new')}>Створити розклад</Button>} />
      <Segmented<Tab> className="mb-4" value={tab} onChange={(t) => setParams(t === 'week' ? {} : { tab: t })}
        options={[{ key: 'week', label: 'Тижневий розклад' }, { key: 'manage', label: `Управління розкладами${periods.length ? ` (${periods.length})` : ''}` }]} />
      {periods.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock className="h-7 w-7" />} title="Розклад ще не налаштовано"
            text="Налаштуйте тижневий розклад один раз на семестр — уроки автоматично з’являтимуться на головній, у журналі та календарі."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/schedule/new')}>Створити розклад</Button>} />
        </Card>
      ) : tab === 'week' ? <WeekView /> : <Manage periods={periods} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week view                                                            */
/* ------------------------------------------------------------------ */

function WeekView() {
  const { student, subjectName, subjectColor } = useSession();
  const today = localTodayISO();
  const [weekStart, setWeekStart] = useState(weekStartISO(today));
  const [mobileDay, setMobileDay] = useState(today);
  const [active, setActive] = useState<{ lesson: ResolvedLesson; day: DaySchedule } | null>(null);
  const [editDay, setEditDay] = useState<DaySchedule | null>(null);
  const days = useScheduleRange(student!.id, weekStart, addDaysISO(weekStart, 6));
  if (!days) return <PageSkeleton />;

  const showWeekend = days.slice(5).some((d) => d.lessons.length || (d.period && d.period.weekdays.includes(d.weekday)));
  const cols = showWeekend ? days : days.slice(0, 5);
  const numbers = [...new Set(cols.flatMap((d) => d.lessons.map((l) => l.number ?? -1)))].sort((a, b) => a - b);
  const periodsOfWeek = [...new Map(days.filter((d) => d.period).map((d) => [d.period!.id, d.period!])).values()];
  const selected = cols.find((d) => d.date === mobileDay) ?? cols[0];
  const fill = (d: DaySchedule) => {
    const planned = d.lessons.filter((l) => !l.cancelled && l.kind !== 'unscheduled');
    return { done: planned.filter((l) => l.observation).length, total: planned.length };
  };
  const shiftWeek = (n: number) => {
    const ws = addDaysISO(weekStart, 7 * n);
    setWeekStart(ws);
    setMobileDay(ws);
  };

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => shiftWeek(-1)} aria-label="Попередній тиждень" />
          <Button size="sm" variant="secondary" onClick={() => { setWeekStart(weekStartISO(today)); setMobileDay(today); }}>Цей тиждень</Button>
          <Button size="sm" variant="secondary" icon={<ChevronRight className="h-4 w-4" />} onClick={() => shiftWeek(1)} aria-label="Наступний тиждень" />
          <h2 className="ml-1 font-bold">{fmtDate(weekStart, 'd MMM')} — {fmtDate(addDaysISO(weekStart, 6), 'd MMM yyyy')}</h2>
          <span className="ml-auto flex flex-wrap gap-1.5">
            {periodsOfWeek.length ? periodsOfWeek.map((p) => <Badge key={p.id} tone="blue">{p.name}</Badge>) : <Badge tone="gray">Розклад на цей тиждень не налаштовано</Badge>}
          </span>
        </div>
      </Card>

      {/* Desktop: weekday columns × lesson rows */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="w-12 border-b border-line p-2 text-left text-xs font-semibold text-muted">№</th>
              {cols.map((d) => {
                const f = fill(d);
                return (
                  <th key={d.date} className={cn('border-b border-line p-2 text-left align-bottom', d.date === today && 'bg-primary-soft/60')}>
                    <button className="focus-ring w-full rounded-lg text-left" onClick={() => setEditDay(d)} title="Змінити уроки на цей день">
                      <span className="block font-bold">{WEEKDAYS[d.weekday - 1].label}</span>
                      <span className="flex items-center justify-between text-xs font-semibold text-muted">
                        {fmtDate(d.date, 'd MMM')}
                        {d.state === 'day-off' ? <span className="inline-flex items-center gap-1"><CalendarOff className="h-3 w-3" />{DAY_OFF_LABELS[d.dayOverride?.dayOff ?? 'other']}</span>
                          : f.total > 0 && <span className={cn(f.done === f.total ? 'text-mint-dark dark:text-mint' : '')} title="Заповнено спостережень">{f.done}/{f.total}</span>}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {numbers.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="p-6 text-center text-muted">На цей тиждень уроків не заплановано.</td></tr>
            )}
            {numbers.map((num) => (
              <tr key={num}>
                <td className="border-b border-line p-2 text-center font-extrabold text-muted">{num < 0 ? '—' : num}</td>
                {cols.map((d) => (
                  <td key={d.date} className={cn('border-b border-line p-1.5 align-top', d.date === today && 'bg-primary-soft/30')}>
                    {d.lessons.filter((l) => (l.number ?? -1) === num).map((l) => (
                      <button key={l.key} onClick={() => setActive({ lesson: l, day: d })}
                        className={cn('focus-ring mb-1 block w-full rounded-xl border border-line bg-card p-2 text-left shadow-soft transition hover:shadow-lift', l.cancelled && 'opacity-60')}
                        style={{ borderLeft: `4px solid ${subjectColor(l.subjectId)}` }}>
                        <span className={cn('block truncate font-semibold', l.cancelled && 'line-through')}>{subjectName(l.subjectId)}</span>
                        <span className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-muted">
                          <span className="inline-flex items-center gap-1">{timeRange(l) && <><Clock className="h-3 w-3" />{timeRange(l)}</>}</span>
                          <StatusDot status={l.status} />
                        </span>
                        {(l.kind !== 'regular' || l.note) && <span className="mt-1 flex flex-wrap items-center gap-1"><KindMark l={l} />{l.note && <span className="truncate text-[11px] text-muted">{l.note}</span>}</span>}
                      </button>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="p-3 text-xs text-muted">Натисніть на урок, щоб заповнити спостереження або змінити урок; на день — щоб змінити розклад лише на цю дату.</p>
      </Card>

      {/* Mobile: day switcher + big cards */}
      <div className="md:hidden">
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Дні тижня">
          {cols.map((d) => {
            const f = fill(d);
            const on = d.date === selected.date;
            return (
              <button key={d.date} role="tab" aria-selected={on} onClick={() => setMobileDay(d.date)}
                className={cn('focus-ring flex min-w-[60px] flex-1 flex-col items-center rounded-2xl border px-2 py-2 text-xs font-semibold transition',
                  on ? 'border-primary bg-primary text-white' : 'border-line bg-card', d.date === today && !on && 'border-primary')}>
                <span>{WEEKDAYS[d.weekday - 1].short}</span>
                <span className="text-base font-extrabold">{Number(d.date.slice(8))}</span>
                <span className={cn('text-[10px]', on ? 'text-white/90' : 'text-muted')}>{d.state === 'day-off' ? 'вихідний' : f.total ? `${f.done}/${f.total}` : '—'}</span>
              </button>
            );
          })}
        </div>
        <Card title={<span className="capitalize">{fmtDate(selected.date, 'EEEE, d MMMM')}</span>} subtitle={selected.period?.name}
          action={selected.period && <Button size="sm" variant="secondary" icon={<Settings2 className="h-4 w-4" />} onClick={() => setEditDay(selected)}>Змінити день</Button>}>
          <DayLessons day={selected} />
        </Card>
        {selected.period && (
          <button onClick={() => setEditDay(selected)} aria-label="Додати урок або змінити день"
            className="fixed bottom-24 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lift">
            <Plus className="h-6 w-6" />
          </button>
        )}
      </div>

      <LessonActions lesson={active?.lesson ?? null} day={active?.day ?? null} onClose={() => setActive(null)} />
      <DayEditor day={editDay ? days.find((d) => d.date === editDay.date) ?? null : null} onClose={() => setEditDay(null)}
        onOpenLesson={(l) => { const d = days.find((x) => x.date === l.date)!; setEditDay(null); setActive({ lesson: l, day: d }); }} />
    </>
  );
}

function StatusDot({ status }: { status: ResolvedLesson['status'] }) {
  const cls = { filled: 'bg-mint', draft: 'bg-sun', none: 'border border-muted', cancelled: 'bg-coral', skipped: 'bg-line' }[status];
  return <span title={{ filled: 'Заповнено', draft: 'Чернетка', none: 'Спостереження відсутнє', cancelled: 'Урок скасовано', skipped: 'Спостереження не проводилося' }[status]} className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cls)} />;
}

/* ------------------------------------------------------------------ */
/* Management                                                           */
/* ------------------------------------------------------------------ */

function periodState(p: SchedulePeriod, today: string) {
  if (p.archived) return { label: 'Архів', tone: 'gray' as const };
  if (p.endDate < today) return { label: 'Завершений', tone: 'gray' as const };
  if (p.startDate > today) return { label: 'Майбутній', tone: 'sun' as const };
  return { label: 'Чинний', tone: 'mint' as const };
}

function Manage({ periods }: { periods: SchedulePeriod[] }) {
  const { student } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const today = localTodayISO();
  const slots = useLiveQuery(() => scheduleRepo.listSlots(student!.id), [student!.id]) ?? [];
  const [basePick, setBasePick] = useState(false);
  const [del, setDel] = useState<{ p: SchedulePeriod; linked: number } | null>(null);
  const sorted = useMemo(() => [...periods].sort((a, b) => Number(a.archived) - Number(b.archived) || b.startDate.localeCompare(a.startDate)), [periods]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/schedule/new')}>Створити розклад</Button>
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setBasePick(true)}>Створити на основі попереднього</Button>
      </div>
      {sorted.map((p) => {
        const st = periodState(p, today);
        const perWeek = slots.filter((s) => s.periodId === p.id && !s.effectiveTo).length;
        return (
          <Card key={p.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {p.isDemo && <Badge tone="sun">демо</Badge>}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted">
                  <span className="inline-flex items-center gap-1"><CalendarRange className="h-4 w-4" />{fmtDate(p.startDate, 'd MMM yyyy')} — {fmtDate(p.endDate, 'd MMM yyyy')}</span>
                  {p.academicYear && <span>{p.academicYear} н. р.</span>}
                  <span>{perWeek} уроків на тиждень · {p.weekdays.map((w) => WEEKDAYS[w - 1].short).join(', ')}</span>
                </p>
                {p.description && <p className="mt-1 text-sm">{p.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/schedule/${p.id}/edit`)}>Редагувати</Button>
                <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => nav(`/schedule/new?from=${p.id}`)}>На основі цього</Button>
                <Button size="sm" variant="ghost" icon={p.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  onClick={async () => {
                    if (p.archived) {
                      const all = await scheduleRepo.listPeriods(p.studentId);
                      const { findOverlaps } = await import('../schedule/scheduleEngine');
                      if (findOverlaps(all, { ...p, archived: false }).length) return toast('Не можна відновити: дати перетинаються з іншим чинним розкладом. Спершу змініть дати.', 'error');
                    }
                    await scheduleRepo.setArchived(p.id, !p.archived);
                    toast(p.archived ? 'Розклад відновлено' : 'Розклад архівовано — він більше не застосовується, але зберігається для історії');
                  }}>{p.archived ? 'Відновити' : 'Архівувати'}</Button>
                <Button size="sm" variant="ghost" className="text-coral-dark" icon={<Trash2 className="h-4 w-4" />}
                  onClick={async () => setDel({ p, linked: await scheduleRepo.linkedObservationCount(p) })}>Видалити</Button>
              </div>
            </div>
          </Card>
        );
      })}

      <Modal open={basePick} onClose={() => setBasePick(false)} title="Створити на основі попереднього" size="sm">
        <p className="mb-3 text-sm text-muted">Тижневий шаблон буде скопійовано. Нові дати, предмети й час ви вкажете в майстрі. Старий розклад залишиться для історії та аналітики.</p>
        <div className="space-y-2">
          {sorted.map((p) => (
            <button key={p.id} onClick={() => nav(`/schedule/new?from=${p.id}`)} className="focus-ring flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-primary-soft">
              <span className="flex-1"><b>{p.name}</b><span className="block text-xs text-muted">{fmtDate(p.startDate, 'd.MM.yyyy')} — {fmtDate(p.endDate, 'd.MM.yyyy')}</span></span>
              <ChevronRight className="h-4 w-4 text-muted" />
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title={`Видалити «${del?.p.name ?? ''}»?`} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setDel(null)}>Скасувати</Button>
          {!del?.p.archived && <Button variant="secondary" icon={<Archive className="h-4 w-4" />} onClick={async () => { await scheduleRepo.setArchived(del!.p.id, true); toast('Розклад архівовано'); setDel(null); }}>Архівувати</Button>}
          <Button variant="danger" onClick={async () => { await scheduleRepo.deletePeriod(del!.p.id); toast('Розклад видалено. Спостереження збережено.'); setDel(null); }}>Видалити</Button>
        </>}>
        <div className="space-y-2 text-sm">
          {del && del.linked > 0 ? (
            <p className="rounded-xl bg-sun-soft p-3">За період дії цього розкладу є <b>{del.linked}</b> спостережень. Вони <b>не будуть видалені</b>, але втратять зв’язок із розкладом в аналітиці заповнення журналу. Рекомендуємо <b>архівувати</b> розклад замість видалення.</p>
          ) : <p>Спостережень за період дії цього розкладу немає.</p>}
          <p className="text-muted">Буде видалено тижневий шаблон і всі зміни окремих днів цього розкладу.</p>
        </div>
      </Modal>
    </div>
  );
}

