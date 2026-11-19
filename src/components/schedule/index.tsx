/**
 * Smart Schedule UI pieces shared by Schedule, Dashboard, Journal and Calendar.
 * All lesson lists come from scheduleEngine.resolveDay — no page computes lessons itself.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ban, CalendarClock, CheckCircle, Circle, Clock, FileClock, MinusCircle, Pencil, Plus, RotateCcw, Sparkles, StickyNote,
  Trash2, CalendarOff, Timer, Repeat, ChevronRight, PenLine,
} from 'lucide-react';
import { useSession } from '../../hooks/useApp';
import { Badge, Button, Input, Modal, Select, Textarea } from '../ui';
import { useConfirm, useToast } from '../ui/feedback';
import { cn, fmtDate } from '../../lib/utils';
import { db } from '../../db/database';
import { subjectsRepo } from '../../db/repositories';
import { scheduleRepo } from '../../schedule/scheduleRepo';
import {
  DAY_OFF_LABELS, KIND_LABELS, STATUS_LABELS, templateAt, timeProblem, timeRange, isoWeekday, localTodayISO, WEEKDAYS,
  type DaySchedule, type LessonStatus, type ResolvedLesson,
} from '../../schedule/scheduleEngine';
import type { DayOffKind, ScheduleSlot } from '../../types/models';

/* ------------------------------------------------------------------ */
/* Navigation helpers                                                   */
/* ------------------------------------------------------------------ */

/** Opens the existing observation, or a new one pre-filled from the schedule. */
export function lessonHref(l: ResolvedLesson): string {
  if (l.observation) return `/observation/${l.observation.id}/edit`;
  const q = new URLSearchParams({ date: l.date, subject: l.subjectId });
  if (l.number !== null) q.set('number', String(l.number));
  if (l.startTime) q.set('start', l.startTime);
  if (l.endTime) q.set('end', l.endTime);
  if (l.kind !== 'manual' && l.kind !== 'unscheduled') q.set('key', l.key);
  if (l.periodId) q.set('period', l.periodId);
  if (l.lessonId) q.set('lesson', l.lessonId);
  return `/observation/new?${q.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Small visual pieces                                                  */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<LessonStatus, { cls: string; icon: ReactNode }> = {
  filled: { cls: 'text-mint-dark dark:text-mint', icon: <CheckCircle className="h-4 w-4" /> },
  draft: { cls: 'text-sun-dark', icon: <FileClock className="h-4 w-4" /> },
  none: { cls: 'text-muted', icon: <Circle className="h-4 w-4" /> },
  cancelled: { cls: 'text-coral-dark', icon: <Ban className="h-4 w-4" /> },
  skipped: { cls: 'text-muted', icon: <MinusCircle className="h-4 w-4" /> },
};

export function StatusLabel({ status, short }: { status: LessonStatus; short?: boolean }) {
  const s = STATUS_STYLE[status];
  const text = short ? ({ filled: 'Заповнено', draft: 'Чернетка', none: 'Немає запису', cancelled: 'Скасовано', skipped: 'Не проводилося' } as const)[status] : STATUS_LABELS[status];
  return <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', s.cls)}>{s.icon}{text}</span>;
}

export function KindMark({ l }: { l: ResolvedLesson }) {
  if (l.kind === 'regular' || l.kind === 'manual') return null;
  return <span title={KIND_LABELS[l.kind]} className="inline-flex"><KindBadge l={l} /></span>;
}

function KindBadge({ l }: { l: ResolvedLesson }) {
  if (l.kind === 'changed') return <Badge tone="sun" className="!px-2"><PenLine className="h-3 w-3" />змінено</Badge>;
  if (l.kind === 'cancelled') return <Badge tone="coral" className="!px-2"><Ban className="h-3 w-3" />скасовано</Badge>;
  if (l.kind === 'extra') return <Badge tone="mint" className="!px-2"><Sparkles className="h-3 w-3" />додатковий</Badge>;
  if (l.kind === 'unscheduled') return <Badge tone="gray" className="!px-2">поза розкладом</Badge>;
  return null;
}

/** One lesson as a row (Dashboard, Journal, Calendar, mobile schedule). */
export function LessonRow({ l, onOpen, compact }: { l: ResolvedLesson; onOpen: (l: ResolvedLesson) => void; compact?: boolean }) {
  const { subjectName, subjectColor } = useSession();
  const nav = useNavigate();
  const t = timeRange(l);
  return (
    <li className={cn('flex items-center gap-3', compact ? 'py-2' : 'py-3', l.cancelled && 'opacity-70')}>
      <button onClick={() => onOpen(l)} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={`Дії з уроком: ${subjectName(l.subjectId)}`}>
        <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-ink" style={{ background: subjectColor(l.subjectId) + '40' }}>
          <span className="text-sm font-extrabold leading-none">{l.number ?? '—'}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={cn('truncate font-semibold', l.cancelled && 'line-through')}>{subjectName(l.subjectId)}</span>
            <KindMark l={l} />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {t && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t}</span>}
            {l.topic && <span className="truncate">{l.topic}</span>}
            {l.note && <span className="inline-flex items-center gap-1"><StickyNote className="h-3 w-3" />{l.note}</span>}
            {l.historical && <span title="Спостереження зберігає предмет, який був на момент запису">історичний запис</span>}
          </span>
        </span>
      </button>
      <span className="hidden sm:inline-flex"><StatusLabel status={l.status} short /></span>
      {l.observation ? (
        <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => nav(lessonHref(l))}>
          <span className="hidden sm:inline">Редагувати запис</span><span className="sm:hidden">Запис</span>
        </Button>
      ) : !l.cancelled && l.status !== 'skipped' ? (
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => nav(lessonHref(l))}>Заповнити</Button>
      ) : (
        <span className="sm:hidden"><StatusLabel status={l.status} short /></span>
      )}
    </li>
  );
}

/** Empty / special states of a day — neutral wording, never a "not filled" warning. */
export function DayStateMessage({ day, onCreate }: { day: DaySchedule; onCreate?: () => void }) {
  if (day.state === 'day-off') {
    const kind = day.dayOverride?.dayOff ?? 'other';
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-bg p-4 text-sm">
        <CalendarOff className="h-5 w-5 text-muted" />
        <span><b>{DAY_OFF_LABELS[kind]}</b>{day.dayOverride?.reason ? ` · ${day.dayOverride.reason}` : ''}. На цей день уроків не заплановано.</span>
      </div>
    );
  }
  if (day.state === 'no-period') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-bg p-5 text-center text-sm">
        <CalendarClock className="h-6 w-6 text-primary" />
        <span>Для цього періоду розклад ще не налаштовано.</span>
        {onCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Створити розклад</Button>}
      </div>
    );
  }
  const label = day.date === localTodayISO() ? 'На сьогодні уроків не заплановано.' : `На ${fmtDate(day.date, 'EEEE, d MMMM')} уроків не заплановано.`;
  return <p className="rounded-2xl bg-bg p-4 text-center text-sm text-muted">{label}</p>;
}

/* ------------------------------------------------------------------ */
/* Lesson actions                                                       */
/* ------------------------------------------------------------------ */

type Mode = 'menu' | 'day' | 'template' | 'note';

export function LessonActions({ lesson, day, onClose }: { lesson: ResolvedLesson | null; day: DaySchedule | null; onClose: () => void }) {
  const { user, subjectName, visibleSubjects } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>('menu');
  const [f, setF] = useState({ subjectId: '', number: '', start: '', end: '', note: '', effective: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);

  useEffect(() => {
    if (!lesson) return;
    setMode('menu');
    setErr('');
    setF({ subjectId: lesson.subjectId, number: lesson.number?.toString() ?? '', start: lesson.startTime ?? '', end: lesson.endTime ?? '', note: lesson.note ?? '', effective: lesson.date });
    if (lesson.slotId) void db.scheduleSlots.get(lesson.slotId).then((s) => setSlot(s ?? null));
    else setSlot(null);
  }, [lesson]);

  if (!lesson || !day) return null;
  const period = day.period;
  const isSlot = !!lesson.slotId && !!period && !!slot;
  const isExtra = lesson.kind === 'extra' || (lesson.kind === 'cancelled' && lesson.key.startsWith('extra:'));
  const hasOverride = !!lesson.overrideId;

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const formPatch = () => {
    const tp = timeProblem(f.start || null, f.end || null);
    if (tp) throw new Error(tp);
    const num = f.number === '' ? null : Number(f.number);
    if (num !== null && (!Number.isInteger(num) || num < 0 || num > 20)) throw new Error('Номер уроку — ціле число від 0 до 20');
    return { subjectId: f.subjectId, lessonNumber: num, startTime: f.start || null, endTime: f.end || null, note: f.note.trim() };
  };

  const saveDay = () => run(async () => {
    const p = formPatch();
    if (isSlot) await scheduleRepo.setSlotOverride(user.id, period!, slot!, lesson.date, p);
    else if (isExtra && lesson.overrideId) await scheduleRepo.updateOverride(lesson.overrideId, p);
  }, 'Зміну збережено лише для цієї дати');

  const saveTemplate = () => run(async () => {
    const p = formPatch();
    if (!f.effective || f.effective < period!.startDate || f.effective > period!.endDate) throw new Error(`Дата початку дії має бути в межах розкладу (${fmtDate(period!.startDate, 'd.MM.yyyy')}–${fmtDate(period!.endDate, 'd.MM.yyyy')})`);
    const all = await db.scheduleSlots.where('periodId').equals(period!.id).toArray();
    const current = templateAt(period!, all, f.effective);
    const desired = current.map((s) => (s.id === slot!.id ? { ...s, subjectId: p.subjectId, lessonNumber: p.lessonNumber ?? s.lessonNumber, startTime: p.startTime, endTime: p.endTime, notes: p.note } : s));
    if (!current.some((s) => s.id === slot!.id)) throw new Error('Цей урок не діє на обрану дату початку дії');
    const clash = desired.find((s) => s.id !== slot!.id && s.weekday === slot!.weekday && s.lessonNumber === (p.lessonNumber ?? slot!.lessonNumber));
    if (clash) throw new Error(`Урок №${clash.lessonNumber} у цей день уже є в розкладі`);
    await scheduleRepo.savePeriod(user.id, period!, desired, { effectiveDate: f.effective });
  }, 'Основний розклад змінено');

  const subjectsSelect = (
    <Select label="Предмет" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
      {visibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  );
  const fields = (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">{subjectsSelect}</div>
      <Input label="№ уроку" type="number" min={0} max={20} inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
      <div />
      <Input label="Початок" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
      <Input label="Кінець" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
      <Input className="col-span-2" label="Примітка" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Необов’язково" />
    </div>
  );

  const title = (
    <span className="flex flex-wrap items-center gap-2">
      {lesson.number !== null && <span className="text-muted">№{lesson.number}</span>}
      {subjectName(lesson.subjectId)}
      <KindMark l={lesson} />
    </span>
  );

  return (
    <Modal open={!!lesson} onClose={onClose} title={title} size="sm"
      footer={mode === 'menu' ? <Button variant="secondary" onClick={onClose}>Закрити</Button> : (
        <>
          <Button variant="secondary" onClick={() => { setMode('menu'); setErr(''); }}>Назад</Button>
          <Button loading={busy} onClick={mode === 'template' ? saveTemplate : mode === 'note' ? () => run(async () => {
            const note = f.note.trim();
            if (isSlot) await scheduleRepo.setSlotOverride(user.id, period!, slot!, lesson.date, { note });
            else if (lesson.overrideId) await scheduleRepo.updateOverride(lesson.overrideId, { note });
          }, 'Примітку збережено') : saveDay}>Зберегти</Button>
        </>
      )}>
      <p className="mb-3 text-sm text-muted">
        <span className="capitalize">{fmtDate(lesson.date, 'EEEE, d MMMM')}</span>
        {timeRange(lesson) && ` · ${timeRange(lesson)}`} · <StatusLabel status={lesson.status} />
      </p>
      {lesson.scheduled && lesson.kind === 'changed' && (
        <p className="mb-3 rounded-xl bg-sun-soft p-2.5 text-xs text-ink">
          За основним розкладом: №{lesson.scheduled.number} · {subjectName(lesson.scheduled.subjectId)}{lesson.scheduled.startTime ? ` · ${lesson.scheduled.startTime}–${lesson.scheduled.endTime ?? ''}` : ''}
        </p>
      )}
      {lesson.historical && (
        <p className="mb-3 rounded-xl bg-primary-soft p-2.5 text-xs text-ink">Спостереження зберігає предмет, номер і час на момент запису. Зміни розкладу їх не переписують.</p>
      )}

      {mode === 'menu' && (
        <div className="space-y-1.5">
          <ActionItem icon={lesson.observation ? <Pencil /> : <Plus />} label={lesson.observation ? 'Відкрити спостереження' : 'Заповнити спостереження'} primary onClick={() => nav(lessonHref(lesson))} />
          {lesson.observation && <ActionItem icon={<Plus />} label="Створити ще одне спостереження для цього уроку" onClick={() => nav(lessonHref({ ...lesson, observation: null }) + '&another=1')} />}
          {(isSlot || isExtra) && <ActionItem icon={<PenLine />} label="Змінити урок лише на цей день" onClick={() => setMode('day')} />}
          {isSlot && <ActionItem icon={<Repeat />} label="Змінити основний розклад" onClick={() => setMode('template')} />}
          {(isSlot || isExtra) && (lesson.cancelled ? (
            <ActionItem icon={<RotateCcw />} label="Відновити урок" onClick={() => run(() => (isSlot ? scheduleRepo.setSlotOverride(user.id, period!, slot!, lesson.date, { cancelled: false }) : scheduleRepo.updateOverride(lesson.overrideId!, { cancelled: false })), 'Урок відновлено')} />
          ) : (
            <ActionItem icon={<Ban />} label="Скасувати урок на цю дату" onClick={() => run(() => (isSlot ? scheduleRepo.setSlotOverride(user.id, period!, slot!, lesson.date, { cancelled: true }) : scheduleRepo.updateOverride(lesson.overrideId!, { cancelled: true })), 'Урок скасовано на цю дату')} />
          ))}
          {(isSlot || isExtra) && !lesson.observation && !lesson.cancelled && (
            <ActionItem icon={<MinusCircle />} label={lesson.skipped ? 'Зняти позначку «Спостереження не проводилося»' : 'Позначити «Спостереження не проводилося»'}
              onClick={() => run(() => (isSlot ? scheduleRepo.setSlotOverride(user.id, period!, slot!, lesson.date, { skipped: !lesson.skipped }) : scheduleRepo.updateOverride(lesson.overrideId!, { skipped: !lesson.skipped })), 'Позначку збережено')} />
          )}
          {(isSlot || isExtra) && <ActionItem icon={<StickyNote />} label="Додати примітку" onClick={() => setMode('note')} />}
          {isSlot && hasOverride && (
            <ActionItem icon={<RotateCcw />} label="Повернути стандартний розклад для цього уроку" onClick={() => run(() => scheduleRepo.removeOverride(lesson.overrideId!), 'Повернуто стандартний розклад')} />
          )}
          {isExtra && (
            <ActionItem icon={<Trash2 />} label="Видалити додатковий урок" danger onClick={async () => {
              if (await confirm({ title: 'Видалити додатковий урок?', text: lesson.observation ? 'Спостереження для цього уроку залишиться в журналі.' : undefined, danger: true, confirmLabel: 'Видалити' })) {
                await run(() => scheduleRepo.removeOverride(lesson.overrideId!), 'Додатковий урок видалено');
              }
            }} />
          )}
          {!isSlot && !isExtra && lesson.kind !== 'unscheduled' && (
            <p className="pt-2 text-xs text-muted">Цей урок додано вручну поза розкладом. Його можна змінити в календарі.</p>
          )}
        </div>
      )}
      {mode === 'day' && <div className="space-y-3"><p className="text-sm">Зміна діє <b>лише {fmtDate(lesson.date, 'd MMMM')}</b>. Тижневий розклад і інші дні не зміняться.</p>{fields}</div>}
      {mode === 'note' && <Textarea label="Примітка до уроку на цю дату" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} autoFocus />}
      {mode === 'template' && (
        <div className="space-y-3">
          <p className="rounded-xl bg-sun-soft p-2.5 text-sm text-ink">Ця зміна може вплинути на майбутні уроки. Оберіть дату початку дії. Уроки до цієї дати залишаться як були, наявні спостереження не зміняться.</p>
          <p className="text-sm">Урок щотижня: <b>{WEEKDAYS[(slot?.weekday ?? isoWeekday(lesson.date)) - 1].label}</b></p>
          {fields}
          <Input label="Діє з" type="date" value={f.effective} min={period?.startDate} max={period?.endDate} onChange={(e) => setF({ ...f, effective: e.target.value })} />
        </div>
      )}
      {err && <p className="mt-3 rounded-xl bg-coral-soft p-2.5 text-sm text-coral-dark" role="alert">{err}</p>}
    </Modal>
  );
}

function ActionItem({ icon, label, onClick, primary, danger }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition [&>svg]:h-5 [&>svg]:w-5',
      primary ? 'bg-primary text-white hover:bg-primary/90' : danger ? 'text-coral-dark hover:bg-coral-soft' : 'hover:bg-primary-soft')}>
      {icon}<span className="flex-1">{label}</span><ChevronRight className="!h-4 !w-4 opacity-50" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Day editor: day off, shortened lessons, extra lesson, reset          */
/* ------------------------------------------------------------------ */

export function DayEditor({ day, onClose, onOpenLesson }: { day: DaySchedule | null; onClose: () => void; onOpenLesson: (l: ResolvedLesson) => void }) {
  const { user, visibleSubjects, subjectName } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [panel, setPanel] = useState<'list' | 'extra' | 'off' | 'short'>('list');
  const [extra, setExtra] = useState({ subjectId: '', number: '', start: '', end: '', note: '' });
  const [off, setOff] = useState<{ kind: DayOffKind; reason: string }>({ kind: 'holiday', reason: '' });
  const [short, setShort] = useState({ duration: '30', breakMinutes: '5', firstStart: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!day) return;
    setPanel('list');
    setErr('');
    const next = Math.max(0, ...day.lessons.map((l) => l.number ?? 0)) + 1;
    setExtra({ subjectId: visibleSubjects[0]?.id ?? '', number: String(next), start: '', end: '', note: '' });
    setOff({ kind: day.dayOverride?.dayOff ?? 'holiday', reason: day.dayOverride?.reason ?? '' });
    const sh = day.dayOverride?.shortened;
    setShort({ duration: String(sh?.duration ?? 30), breakMinutes: String(sh?.breakMinutes ?? 5), firstStart: sh?.firstStart ?? '' });
  }, [day, visibleSubjects]);

  const overridesCount = useMemo(() => day?.lessons.filter((l) => l.overrideId).length ?? 0, [day]);
  if (!day) return null;
  const p = day.period;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      setPanel('list');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal open={!!day} onClose={onClose} size="md" title={<span className="capitalize">{fmtDate(day.date, 'EEEE, d MMMM yyyy')}</span>}
      footer={<Button variant="secondary" onClick={onClose}>Готово</Button>}>
      {!p ? (
        <DayStateMessage day={day} onCreate={() => { onClose(); nav('/schedule/new'); }} />
      ) : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><CalendarClock className="h-4 w-4" />Розклад: <b className="text-ink">{p.name}</b></p>
          {panel === 'list' && (
            <>
              {day.state === 'day-off' ? <DayStateMessage day={day} /> : day.lessons.length === 0 ? <DayStateMessage day={day} /> : (
                <ul className="divide-y divide-line">
                  {day.lessons.map((l) => (
                    <li key={l.key} className="flex items-center gap-2 py-2">
                      <span className="w-6 text-sm font-bold text-muted">{l.number ?? '—'}</span>
                      <span className={cn('flex-1 text-sm font-semibold', l.cancelled && 'line-through opacity-70')}>{subjectName(l.subjectId)} <KindMark l={l} /></span>
                      <span className="text-xs text-muted">{timeRange(l)}</span>
                      <Button size="sm" variant="ghost" onClick={() => onOpenLesson(l)}>Дії</Button>
                    </li>
                  ))}
                </ul>
              )}
              {day.dayOverride?.shortened && <p className="rounded-xl bg-sun-soft p-2.5 text-sm"><Timer className="mr-1 inline h-4 w-4" />Скорочені уроки: {day.dayOverride.shortened.duration} хв, перерви {day.dayOverride.shortened.breakMinutes} хв.</p>}
              <div className="flex flex-wrap gap-2">
                {day.state !== 'day-off' && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setPanel('extra')}>Додатковий урок</Button>}
                {day.state === 'day-off'
                  ? <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => act(() => scheduleRepo.setDay(user.id, p, day.date, { dayOff: null, reason: '', shortened: day.dayOverride?.shortened ?? null }), 'Уроки повернуто')}>Повернути уроки</Button>
                  : <Button size="sm" variant="secondary" icon={<CalendarOff className="h-4 w-4" />} onClick={() => setPanel('off')}>День без занять</Button>}
                {day.state !== 'day-off' && (day.dayOverride?.shortened
                  ? <Button size="sm" variant="secondary" icon={<Timer className="h-4 w-4" />} onClick={() => act(() => scheduleRepo.setDay(user.id, p, day.date, { dayOff: day.dayOverride?.dayOff ?? null, shortened: null }), 'Звичайна тривалість уроків')}>Скасувати скорочення</Button>
                  : <Button size="sm" variant="secondary" icon={<Timer className="h-4 w-4" />} onClick={() => setPanel('short')}>Скорочені уроки</Button>)}
                {(overridesCount > 0 || day.dayOverride) && (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={async () => {
                    if (await confirm({ title: 'Повернути стандартний розклад на цей день?', text: 'Усі зміни, скасування й додаткові уроки цієї дати буде прибрано. Спостереження залишаться.', confirmLabel: 'Повернути' })) {
                      await act(() => scheduleRepo.resetDate(p.id, day.date), 'Повернуто стандартний розклад');
                    }
                  }}>Скинути зміни дня</Button>
                )}
              </div>
            </>
          )}
          {panel === 'extra' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Select label="Предмет" value={extra.subjectId} onChange={(e) => setExtra({ ...extra, subjectId: e.target.value })}>
                  {visibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <Input label="№ уроку" type="number" min={0} max={20} value={extra.number} onChange={(e) => setExtra({ ...extra, number: e.target.value })} />
              <div />
              <Input label="Початок" type="time" value={extra.start} onChange={(e) => setExtra({ ...extra, start: e.target.value })} />
              <Input label="Кінець" type="time" value={extra.end} onChange={(e) => setExtra({ ...extra, end: e.target.value })} />
              <Input className="col-span-2" label="Примітка" value={extra.note} onChange={(e) => setExtra({ ...extra, note: e.target.value })} />
              <div className="col-span-2 flex gap-2">
                <Button variant="secondary" onClick={() => setPanel('list')}>Назад</Button>
                <Button onClick={() => act(async () => {
                  const tp = timeProblem(extra.start || null, extra.end || null);
                  if (tp) throw new Error(tp);
                  if (!extra.subjectId) throw new Error('Оберіть предмет');
                  await scheduleRepo.addExtra(user.id, p, day.date, { subjectId: extra.subjectId, lessonNumber: extra.number ? Number(extra.number) : null, startTime: extra.start || null, endTime: extra.end || null, note: extra.note.trim() || undefined });
                }, 'Додатковий урок додано')}>Додати урок</Button>
              </div>
            </div>
          )}
          {panel === 'off' && (
            <div className="space-y-3">
              <Select label="Причина" value={off.kind} onChange={(e) => setOff({ ...off, kind: e.target.value as DayOffKind })}>
                {Object.entries(DAY_OFF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input label="Коментар" value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} placeholder="Необов’язково" />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setPanel('list')}>Назад</Button>
                <Button onClick={() => act(() => scheduleRepo.setDay(user.id, p, day.date, { dayOff: off.kind, reason: off.reason.trim(), shortened: day.dayOverride?.shortened ?? null }), 'День позначено без занять')}>Зберегти</Button>
              </div>
            </div>
          )}
          {panel === 'short' && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Час уроків цього дня буде перераховано: уроки йдуть підряд з однаковою тривалістю та перервами.</p>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Урок, хв" type="number" min={5} max={90} value={short.duration} onChange={(e) => setShort({ ...short, duration: e.target.value })} />
                <Input label="Перерва, хв" type="number" min={0} max={60} value={short.breakMinutes} onChange={(e) => setShort({ ...short, breakMinutes: e.target.value })} />
                <Input label="Початок" type="time" value={short.firstStart} onChange={(e) => setShort({ ...short, firstStart: e.target.value })} hint="як у розкладі, якщо порожньо" />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setPanel('list')}>Назад</Button>
                <Button onClick={() => act(async () => {
                  const d = Number(short.duration);
                  const b = Number(short.breakMinutes);
                  if (!(d >= 5 && d <= 90) || !(b >= 0 && b <= 60)) throw new Error('Перевірте тривалість уроку й перерви');
                  if (!short.firstStart && !day.lessons.some((l) => l.startTime)) throw new Error('Вкажіть час початку першого уроку');
                  await scheduleRepo.setDay(user.id, p, day.date, { dayOff: null, shortened: { duration: d, breakMinutes: b, firstStart: short.firstStart || null } });
                }, 'Скорочені уроки збережено')}>Зберегти</Button>
              </div>
            </div>
          )}
          {err && <p className="rounded-xl bg-coral-soft p-2.5 text-sm text-coral-dark" role="alert">{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Day lesson list with built-in actions (Dashboard / Journal / Calendar) */
/* ------------------------------------------------------------------ */

export function DayLessons({ day, compact, emptyAction }: { day: DaySchedule; compact?: boolean; emptyAction?: () => void }) {
  const [active, setActive] = useState<ResolvedLesson | null>(null);
  const nav = useNavigate();
  return (
    <>
      {day.lessons.length === 0 ? (
        <DayStateMessage day={day} onCreate={emptyAction ?? (() => nav('/schedule/new'))} />
      ) : (
        <>
          {day.state === 'day-off' && <div className="mb-2"><DayStateMessage day={day} /></div>}
          <ul className="divide-y divide-line">
            {day.lessons.map((l) => <LessonRow key={l.key} l={l} compact={compact} onOpen={setActive} />)}
          </ul>
        </>
      )}
      <LessonActions lesson={active} day={day} onClose={() => setActive(null)} />
    </>
  );
}

/** Inline creation of a subject without leaving the form. */
export function NewSubjectInline({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { user } = useSession();
  const [name, setName] = useState('');
  const toast = useToast();
  return (
    <div className="flex items-end gap-2 rounded-xl bg-bg p-2">
      <Input label="Новий предмет" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="flex-1" placeholder="Назва предмета" />
      <Button size="sm" onClick={async () => {
        if (name.trim().length < 2) return toast('Введіть назву предмета', 'error');
        const s = await subjectsRepo.save(user.id, { name: name.trim() });
        toast(`Предмет «${s.name}» додано`);
        onCreated(s.id);
      }}>Додати</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Скасувати</Button>
    </div>
  );
}

export function ScheduleLink({ children = 'Переглянути розклад' }: { children?: ReactNode }) {
  return <Link to="/schedule" className="text-sm font-semibold text-primary hover:underline">{children}</Link>;
}
